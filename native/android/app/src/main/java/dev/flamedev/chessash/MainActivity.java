package dev.flamedev.chessash;

import android.app.NativeActivity;
import android.content.ClipData;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public final class MainActivity extends NativeActivity {
    private static final int PICK_FILE = 400;
    private static final int SAVE_PGN = 401;
    private static final int MAX_IMPORT_BYTES = 128 * 1024 * 1024;
    private volatile long insets;
    private volatile boolean legacyStoragePending;
    private AudioTrack tap;
    private byte[] pendingPgn;

    private static native void onFile(byte[] bytes, String error);

    @Override
    protected void onCreate(Bundle state) {
        legacyStoragePending = LegacyStorage.needsMigration(this);
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().getInsetsController().setSystemBarsAppearance(0,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(0);
        }
        getWindow().getDecorView().setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                var safe = windowInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = safe.top;
                bottom = safe.bottom;
            } else {
                top = windowInsets.getSystemWindowInsetTop();
                bottom = windowInsets.getSystemWindowInsetBottom();
            }
            insets = ((long) top << 32) | (bottom & 0xffffffffL);
            return windowInsets;
        });
        getWindow().getDecorView().requestApplyInsets();
        if (legacyStoragePending) {
            LegacyStorage.stage(this, new LegacyStorage.Callback() {
                @Override public void onSnapshot(File file) { legacyStoragePending = false; }
                @Override public void onError(String message) {
                    legacyStoragePending = false;
                    if (!isDestroyed()) Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    public String engineDirectory() {
        return getApplicationInfo().nativeLibraryDir;
    }

    public long verticalInsets() {
        return insets;
    }

    public boolean legacyMigrationPending() {
        return legacyStoragePending;
    }

    public void pickFile(String mime) {
        runOnUiThread(() -> {
            try {
                var intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime);
                startActivityForResult(intent, PICK_FILE);
            } catch (RuntimeException error) {
                onFile(null, error.getMessage());
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode == SAVE_PGN) {
            byte[] data = pendingPgn;
            pendingPgn = null;
            if (data != null && resultCode == RESULT_OK && result != null && result.getData() != null) {
                try (var output = getContentResolver().openOutputStream(result.getData())) {
                    if (output == null) throw new IllegalStateException("Could not open the export destination.");
                    output.write(data);
                } catch (Exception error) {
                    Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            return;
        }
        if (requestCode != PICK_FILE) return;
        if (resultCode != RESULT_OK || result == null || result.getData() == null) {
            onFile(null, null);
            return;
        }
        Uri uri = result.getData();
        new Thread(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IllegalStateException("The selected document could not be opened.");
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (output.size() + read > MAX_IMPORT_BYTES) throw new IllegalArgumentException("The selected document exceeds 128 MB.");
                    output.write(buffer, 0, read);
                }
                onFile(output.toByteArray(), null);
            } catch (Exception error) {
                onFile(null, error.getMessage());
            }
        }, "chessash-document-read").start();
    }

    public void savePgn(byte[] data) {
        runOnUiThread(() -> {
            try {
                pendingPgn = data;
                var intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/x-chess-pgn").putExtra(Intent.EXTRA_TITLE, "ChessAsh review.pgn");
                startActivityForResult(intent, SAVE_PGN);
            } catch (RuntimeException error) {
                pendingPgn = null;
                Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    public void sharePng(String filename, byte[] png) {
        runOnUiThread(() -> {
            try {
                File dir = new File(getCacheDir(), "review-cards");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("Could not create share cache.");
                File file = File.createTempFile("chessash-", ".png", dir);
                try (var output = new FileOutputStream(file)) {
                    output.write(png);
                }
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file, filename);
                var send = new Intent(Intent.ACTION_SEND).setType("image/png")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_TEXT, "https://github.com/FlameFirelife/ChessAsh")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri(filename, uri));
                startActivity(Intent.createChooser(send, null));
            } catch (Exception error) {
                Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    public void playTap(byte[] data) {
        runOnUiThread(() -> {
            try {
                if (tap == null) {
                    tap = new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                        .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                        .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(data.length).build();
                    tap.write(data, 0, data.length);
                } else {
                    tap.stop();
                    tap.reloadStaticData();
                }
                tap.play();
            } catch (RuntimeException ignored) {
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (tap != null) tap.release();
        super.onDestroy();
    }
}
