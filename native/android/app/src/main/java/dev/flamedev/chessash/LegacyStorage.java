package dev.flamedev.chessash;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONTokener;

public final class LegacyStorage {
    private static final String PACKAGE = "dev.flamedev.chessash";
    private static final String ORIGIN = "https://localhost";
    private static final String URL = ORIGIN + "/chessash-native-migration";
    private static final int MAX_BYTES = 128 * 1024 * 1024;
    private static final int CHUNK_CHARS = 32 * 1024;
    private static final String SCRIPT = "legacy-snapshot.js";
    private static final String SNAPSHOT = "chessash-v15-migration.json";
    private static final String DONE = "chessash-v15-migrated";

    public interface Callback {
        void onSnapshot(File file);
        void onError(String message);
    }

    private LegacyStorage() {}

    static boolean needsMigration(Activity activity) {
        File files = activity.getFilesDir();
        return PACKAGE.equals(activity.getPackageName()) && new File(activity.getDataDir(), "app_webview").isDirectory()
            && !new File(files, DONE).isFile()
            && !new File(files, SNAPSHOT).isFile();
    }

    public static void stage(Activity activity, Callback callback) {
        if (!PACKAGE.equals(activity.getPackageName())) {
            callback.onError("V1.5 migration requires an in-place ChessAsh update.");
            return;
        }
        activity.runOnUiThread(() -> {
            try (var input = new InputStreamReader(activity.getAssets().open(SCRIPT), StandardCharsets.UTF_8)) {
                StringBuilder script = new StringBuilder();
                char[] buffer = new char[4096];
                int read;
                while ((read = input.read(buffer)) != -1) script.append(buffer, 0, read);
                new Reader(activity, callback, script.toString()).start();
            } catch (IOException | RuntimeException error) {
                callback.onError("Could not open the legacy ChessAsh storage reader.");
            }
        });
    }

    private static final class Reader extends WebViewClient {
        private final Activity activity;
        private final Callback callback;
        private final String script;
        private final WebView browser;
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Runnable timeout = () -> finish("V1.5 storage did not respond.");
        private AtomicFile atomic;
        private FileOutputStream output;
        private int charsWritten;
        private int bytesWritten;
        private boolean entered;
        private boolean closed;

        Reader(Activity activity, Callback callback, String script) {
            this.activity = activity;
            this.callback = callback;
            this.script = script;
            this.browser = new WebView(activity);
        }

        void start() {
            var settings = browser.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowContentAccess(false);
            settings.setAllowFileAccess(false);
            browser.setWebViewClient(this);
            handler.postDelayed(timeout, 45_000);
            browser.loadUrl(URL);
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return true;
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String page = request.isForMainFrame() && URL.equals(request.getUrl().toString())
                ? "<!doctype html><meta charset=utf-8><meta http-equiv=Content-Security-Policy content=\"default-src 'none'\"><title>ChessAsh migration</title>"
                : "";
            return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8)));
        }

        @Override public void onPageFinished(WebView view, String url) {
            if (closed || entered || !URL.equals(url)) return;
            entered = true;
            browser.evaluateJavascript(script + "\nwindow.chessAshMigration = null; (async () => {" +
                "if (location.origin !== '" + ORIGIN + "') throw Error('Incorrect storage origin');" +
                "window.chessAshMigration = JSON.stringify(await chessAshLegacySnapshot());" +
                "})().catch(() => { window.chessAshMigration = false; });", value -> poll());
        }

        private void poll() {
            if (closed) return;
            browser.evaluateJavascript("window.chessAshMigration === false ? -1 : " +
                "(typeof window.chessAshMigration === 'string' ? window.chessAshMigration.length : null)", value -> {
                if (closed) return;
                if (value == null || "null".equals(value)) {
                    handler.postDelayed(this::poll, 150);
                } else if ("-1".equals(value)) {
                    finish("Could not read the V1.5 ChessAsh library.");
                } else {
                    try {
                        beginSnapshot(Integer.parseInt(value));
                    } catch (NumberFormatException error) {
                        finish("Could not read the V1.5 ChessAsh library.");
                    }
                }
            });
        }

        private void beginSnapshot(int length) {
            if (length <= 0 || length > MAX_BYTES) {
                finish("The V1.5 library backup exceeds the supported size.");
                return;
            }
            File file = new File(activity.getFilesDir(), SNAPSHOT);
            atomic = new AtomicFile(file);
            try {
                output = atomic.startWrite();
            } catch (IOException error) {
                finish("Could not stage the V1.5 library.");
                return;
            }
            handler.removeCallbacks(timeout);
            handler.postDelayed(timeout, 90_000);
            readChunk(file, length);
        }

        private void readChunk(File file, int length) {
            int end = Math.min(charsWritten + CHUNK_CHARS, length);
            String command = "(() => { const text = window.chessAshMigration; let end = " + end +
                "; if (end < text.length && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end--;" +
                "return text.slice(" + charsWritten + ", end); })()";
            browser.evaluateJavascript(command, value -> {
                if (closed) return;
                try {
                    Object decoded = new JSONTokener(value == null ? "null" : value).nextValue();
                    if (!(decoded instanceof String chunk) || chunk.isEmpty()) {
                        throw new JSONException("Invalid snapshot chunk");
                    }
                    byte[] bytes = chunk.getBytes(StandardCharsets.UTF_8);
                    bytesWritten += bytes.length;
                    charsWritten += chunk.length();
                    if (bytesWritten > MAX_BYTES || charsWritten > length) throw new IOException("Snapshot too large");
                    output.write(bytes);
                    if (charsWritten == length) {
                        atomic.finishWrite(output);
                        output = null;
                        close();
                        callback.onSnapshot(file);
                    } else {
                        readChunk(file, length);
                    }
                } catch (IOException | JSONException error) {
                    finish("Could not stage the V1.5 library.");
                }
            });
        }

        private void finish(String error) {
            if (closed) return;
            if (output != null) atomic.failWrite(output);
            close();
            callback.onError(error);
        }

        private void close() {
            closed = true;
            handler.removeCallbacks(timeout);
            browser.destroy();
        }
    }
}
