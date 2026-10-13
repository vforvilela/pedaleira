package com.tonesmith.app;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Liga e desliga o AudioService a partir do JS (js/platform.js: backgroundAudio).
// start() precisa vir com o app na frente (regra do Android 14 para serviço de microfone): o JS chama logo
// depois de Ligar, que é sempre um toque na tela.
@CapacitorPlugin(name = "AudioService")
public class AudioServicePlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        Intent i = new Intent(getContext(), AudioService.class);
        i.putExtra("text", call.getString("text", "Tocando"));
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), AudioService.class));
        call.resolve();
    }
}
