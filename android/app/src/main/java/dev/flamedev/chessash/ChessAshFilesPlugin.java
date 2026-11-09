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

    @PluginMethod public void shareImage(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.length() > 12_000_000) { call.reject("Invalid image content"); return; }
        try {
            byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            if (bytes.length < 8 || bytes[0] != (byte)137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71) throw new IllegalArgumentException("Invalid PNG");
            java.io.File folder = new java.io.File(getContext().getCacheDir(), "review-cards");
            if (!folder.isDirectory() && !folder.mkdirs()) throw new IllegalStateException("Cannot prepare shared image");
            java.io.File image = new java.io.File(folder, "ChessAsh-" + java.util.UUID.randomUUID() + ".png");
            try (OutputStream output = new java.io.FileOutputStream(image)) { output.write(bytes); }
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", image);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("image/png");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.putExtra(Intent.EXTRA_TEXT, "https://github.com/FlameFirelife/ChessAsh");
            intent.setClipData(android.content.ClipData.newRawUri("ChessAsh review", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(Intent.createChooser(intent, "ChessAsh"));
                    call.resolve();
                } catch (Exception error) { call.reject("Could not open sharing: " + error.getMessage()); }
            });
        } catch (Exception error) { call.reject("Could not share image: " + error.getMessage()); }
    }

    @PluginMethod public void saveImage(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.length() > 12_000_000) { call.reject("Invalid image content"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/png");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "chessash-review.png").replaceAll("[^a-zA-Z0-9._-]", "_"));
        startActivityForResult(call, intent, "imageCreated");
    }

    @ActivityCallback private void imageCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject(); response.put("saved", false); call.resolve(response); return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            if (stream == null) throw new IllegalStateException("Cannot open selected document");
            byte[] bytes = android.util.Base64.decode(call.getString("base64", ""), android.util.Base64.DEFAULT);
            if (bytes.length < 8 || bytes[0] != (byte)137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71) throw new IllegalArgumentException("Invalid PNG");
            stream.write(bytes);
            JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
        } catch (Exception error) { call.reject("Could not save image: " + error.getMessage()); }
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
