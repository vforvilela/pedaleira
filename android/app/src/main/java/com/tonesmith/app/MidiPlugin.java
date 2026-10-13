package com.tonesmith.app;

import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// MIDI nativo: o WebView do Android não tem Web MIDI. Abre todas as entradas (USB OTG, Bluetooth MIDI) e entrega
// cada mensagem ao JS no evento "message" com os bytes crus, como o onmidimessage do navegador.
// Aparelho ligado depois também entra: o MidiManager avisa.
@CapacitorPlugin(name = "Midi")
public class MidiPlugin extends Plugin {
    private MidiManager manager;
    private final Map<String, MidiDevice> open = new HashMap<>();
    private final Map<String, String> names = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean started;

    @Override
    public void load() {
        manager = (MidiManager) getContext().getSystemService(Context.MIDI_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (manager == null) { call.reject("Sem MIDI neste aparelho"); return; }
        if (!started) {
            started = true;
            manager.registerDeviceCallback(new MidiManager.DeviceCallback() {
                @Override public void onDeviceAdded(MidiDeviceInfo info) { connect(info); }
                @Override public void onDeviceRemoved(MidiDeviceInfo info) { disconnect(key(info)); }
            }, main);
            for (MidiDeviceInfo info : manager.getDevices()) connect(info);
        }
        call.resolve(inputs());
    }

    @PluginMethod
    public void list(PluginCall call) { call.resolve(inputs()); }

    private JSObject inputs() {
        JSArray list = new JSArray();
        for (String n : names.values()) list.put(n);
        return new JSObject().put("inputs", list);
    }

    private static String key(MidiDeviceInfo info) { return String.valueOf(info.getId()); }

    private static String name(MidiDeviceInfo info) {
        String n = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME);
        return n != null ? n : info.getProperties().getString(MidiDeviceInfo.PROPERTY_PRODUCT, "MIDI " + info.getId());
    }

    // "Output port" do aparelho é o que manda dados para nós.
    private void connect(MidiDeviceInfo info) {
        if (info.getOutputPortCount() == 0 || open.containsKey(key(info))) return;
        manager.openDevice(info, device -> {
            if (device == null) return;
            String k = key(info);
            open.put(k, device);
            names.put(k, name(info));
            for (int i = 0; i < info.getOutputPortCount(); i++) {
                MidiOutputPort port = device.openOutputPort(i);
                if (port != null) port.connect(new Parser());
            }
            notifyListeners("inputs", inputs());
        }, main);
    }

    private void disconnect(String k) {
        MidiDevice d = open.remove(k);
        names.remove(k);
        if (d != null) try { d.close(); } catch (IOException ignored) { }
        notifyListeners("inputs", inputs());
    }

    // Separa o fluxo em mensagens de canal (status + 1 ou 2 bytes), com running status; ignora SysEx e realtime.
    private class Parser extends MidiReceiver {
        private int status = 0, need = 0;
        private final List<Integer> buf = new ArrayList<>();

        @Override
        public void onSend(byte[] msg, int offset, int count, long timestamp) {
            for (int i = offset; i < offset + count; i++) {
                int b = msg[i] & 0xff;
                if (b >= 0xf8) continue;                       // realtime (clock, active sensing)
                if (b >= 0xf0) { status = 0; buf.clear(); continue; } // system common / SysEx: fora
                if (b >= 0x80) {
                    status = b;
                    int t = b & 0xf0;
                    need = (t == 0xc0 || t == 0xd0) ? 1 : 2;
                    buf.clear();
                    continue;
                }
                if (status == 0) continue;
                buf.add(b);
                if (buf.size() == need) {
                    JSArray data = new JSArray();
                    data.put(status);
                    for (int v : buf) data.put(v);
                    buf.clear();
                    notifyListeners("message", new JSObject().put("data", data));
                }
            }
        }
    }
}
