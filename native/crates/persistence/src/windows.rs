use std::{path::Path, ptr, slice};

use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};
use zeroize::{Zeroize, Zeroizing};

use super::{Error, Result, Store, TutorMode, TutorSettings};

pub enum CredentialChange<'a> {
    Keep,
    Remove,
    Set(&'a str),
}

impl Store {
    pub fn save_tutor_settings(
        &mut self,
        settings: &TutorSettings,
        credential: CredentialChange<'_>,
    ) -> Result<()> {
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous: Option<String> = transaction
            .query_row(
                "SELECT value FROM metadata WHERE key = 'tutor'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let previous: TutorSettings = previous
            .map(|value| serde_json::from_str(&value))
            .transpose()?
            .unwrap_or_default();
        let endpoint_changed =
            previous.endpoint.trim_end_matches('/') != settings.endpoint.trim_end_matches('/');
        match credential {
            CredentialChange::Set(secret) => {
                if secret.is_empty()
                    || settings.mode != TutorMode::Api
                    || settings.endpoint.is_empty()
                {
                    return Err(Error::Invalid("An API endpoint and key are required."));
                }
                transaction.execute(
                    "INSERT INTO credentials VALUES ('tutor', ?1)
                     ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext",
                    [dpapi(secret.as_bytes(), true)?.as_slice()],
                )?;
            }
            CredentialChange::Remove => {
                transaction.execute("DELETE FROM credentials WHERE key = 'tutor'", [])?;
            }
            CredentialChange::Keep if endpoint_changed => {
                transaction.execute("DELETE FROM credentials WHERE key = 'tutor'", [])?;
            }
            CredentialChange::Keep => {}
        }
        transaction.execute(
            "INSERT INTO metadata VALUES ('tutor', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(settings)?],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn tutor_api_key(&self, endpoint: &str) -> Result<Option<Zeroizing<String>>> {
        let saved: Option<(String, Vec<u8>)> = self
            .db
            .query_row(
                "SELECT settings.value, secret.ciphertext
             FROM metadata settings JOIN credentials secret ON secret.key = 'tutor'
             WHERE settings.key = 'tutor'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((settings, cipher)) = saved else {
            return Ok(None);
        };
        let settings: TutorSettings = serde_json::from_str(&settings)?;
        if settings.mode != TutorMode::Api
            || endpoint.trim_end_matches('/') != settings.endpoint.trim_end_matches('/')
        {
            return Ok(None);
        }
        let mut bytes = dpapi(&cipher, false)?;
        let secret = String::from_utf8(std::mem::take(&mut *bytes)).map_err(|error| {
            error.into_bytes().zeroize();
            Error::Credential
        })?;
        Ok(Some(Zeroizing::new(secret)))
    }

    pub fn import_windows_tutor_credential(&mut self, profile: &Path) -> Result<bool> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LegacyTutor {
            #[serde(flatten)]
            settings: TutorSettings,
            encrypted_key: Option<String>,
        }
        let bytes = match std::fs::read(profile.join("tutor-settings.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        let legacy: LegacyTutor = serde_json::from_slice(&bytes)?;
        let Some(encrypted_key) = legacy.encrypted_key else {
            return Ok(false);
        };
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current: Option<String> = transaction
            .query_row(
                "SELECT value FROM metadata WHERE key = 'tutor'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let current: TutorSettings = current
            .map(|value| serde_json::from_str(&value))
            .transpose()?
            .unwrap_or_else(|| legacy.settings.clone());
        if current.mode != TutorMode::Api
            || current.endpoint.trim_end_matches('/')
                != legacy.settings.endpoint.trim_end_matches('/')
        {
            return Ok(false);
        }
        let credential_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM credentials WHERE key = 'tutor')",
            [],
            |row| row.get(0),
        )?;
        let credential_imported: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM metadata WHERE key = 'legacy_tutor_credential')",
            [],
            |row| row.get(0),
        )?;
        if credential_exists || credential_imported {
            return Ok(false);
        }
        let password = decrypt_electron(profile, &encrypted_key)?;
        let ciphertext = dpapi(&password, true)?;
        transaction.execute(
            "INSERT INTO credentials VALUES ('tutor', ?1)",
            [ciphertext.as_slice()],
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO metadata VALUES ('tutor', ?1)",
            [serde_json::to_string(&current)?],
        )?;
        transaction.execute(
            "INSERT INTO metadata VALUES ('legacy_tutor_credential', 'true')",
            [],
        )?;
        transaction.commit()?;
        Ok(true)
    }
}

fn decrypt_electron(profile: &Path, encrypted: &str) -> Result<Zeroizing<Vec<u8>>> {
    let encrypted = STANDARD.decode(encrypted).map_err(|_| Error::Credential)?;
    let Some(cipher) = encrypted.strip_prefix(b"v10") else {
        return dpapi(&encrypted, false);
    };
    let preferences: serde_json::Value =
        serde_json::from_slice(&std::fs::read(profile.join("Local State"))?)?;
    let key = preferences
        .pointer("/os_crypt/encrypted_key")
        .and_then(serde_json::Value::as_str)
        .ok_or(Error::Credential)?;
    let key = STANDARD.decode(key).map_err(|_| Error::Credential)?;
    let key = dpapi(key.strip_prefix(b"DPAPI").ok_or(Error::Credential)?, false)?;
    let (nonce, message) = cipher.split_at_checked(12).ok_or(Error::Credential)?;
    let algorithm = Aes256Gcm::new_from_slice(&key).map_err(|_| Error::Credential)?;
    let plaintext = algorithm
        .decrypt(aes_gcm::Nonce::from_slice(nonce), message)
        .map_err(|_| Error::Credential)?;
    Ok(Zeroizing::new(plaintext))
}

fn dpapi(bytes: &[u8], encrypt: bool) -> Result<Zeroizing<Vec<u8>>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| Error::Credential)?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 || output.pbData.is_null() {
        return Err(Error::Credential);
    }
    let data = unsafe { slice::from_raw_parts_mut(output.pbData, output.cbData as usize) };
    let result = Zeroizing::new(data.to_vec());
    data.zeroize();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn migrates_a_dpapi_wrapped_chromium_profile_without_exposing_the_key() {
        let profile = std::env::temp_dir().join(format!(
            "chessash-legacy-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir(&profile).unwrap();
        let key = [42; 32];
        let nonce = [39; 12];
        let secret = "example test credential";
        let encrypted = Aes256Gcm::new_from_slice(&key)
            .unwrap()
            .encrypt(aes_gcm::Nonce::from_slice(&nonce), secret.as_bytes())
            .unwrap();
        let stored_key = [b"DPAPI", dpapi(&key, true).unwrap().as_slice()].concat();
        let stored_secret = [b"v10", nonce.as_slice(), encrypted.as_slice()].concat();
        let endpoint = "https://example.invalid";
        fs::write(
            profile.join("Local State"),
            json!({
                "os_crypt": {"encrypted_key": STANDARD.encode(stored_key)}
            })
            .to_string(),
        )
        .unwrap();
        fs::write(profile.join("tutor-settings.json"), json!({
            "mode": "api", "endpoint": endpoint, "model": "test", "encryptedKey": STANDARD.encode(stored_secret)
        }).to_string()).unwrap();
        let mut store = Store::open(":memory:").unwrap();
        assert!(store.import_windows_tutor_credential(&profile).unwrap());
        assert_eq!(
            store
                .tutor_api_key(endpoint)
                .unwrap()
                .as_deref()
                .map(String::as_str),
            Some(secret)
        );
        assert!(
            store
                .tutor_api_key("https://different.invalid")
                .unwrap()
                .is_none()
        );
        let settings = store.tutor_settings().unwrap();
        store
            .save_tutor_settings(&settings, CredentialChange::Remove)
            .unwrap();
        assert!(store.tutor_api_key(endpoint).unwrap().is_none());
        assert!(!store.import_windows_tutor_credential(&profile).unwrap());
        fs::remove_file(profile.join("Local State")).unwrap();
        fs::remove_file(profile.join("tutor-settings.json")).unwrap();
        fs::remove_dir(profile).unwrap();
    }
}
