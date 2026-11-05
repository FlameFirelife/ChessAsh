package dev.flamedev.chessash;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "ChessAshFiles")
public class ChessAshFilesPlugin extends Plugin {
    @PluginMethod public void saveText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.length() > 8_000_000) { call.reject("Invalid file content"); return; }
        String filename = call.getString("filename", "chessash-review.pgn").replaceAll("[^a-zA-Z0-9._-]", "_");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/x-chess-pgn");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "fileCreated");
    }

    @ActivityCallback private void fileCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject(); response.put("saved", false); call.resolve(response); return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            if (stream == null) throw new IllegalStateException("Cannot open selected document");
            stream.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
        } catch (Exception error) { call.reject("Could not save PGN: " + error.getMessage()); }
    }
}
