package com.tonesmith.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// MIDI nativo: o WebView do Android não tem Web MIDI. Abre todas as entradas (USB OTG) e entrega cada mensagem
// ao JS no evento "message" com os bytes crus, como o onmidimessage do navegador. Aparelho ligado depois também
// entra: o MidiManager avisa.
// Bluetooth MIDI (footswitch sem fio, ex.: M-VAVE Chocolate): o Android não liga sozinho; bluetooth() pede a
// permissão, procura por BLE os aparelhos que anunciam o serviço MIDI e abre cada um pelo MidiManager.
@CapacitorPlugin(name = "Midi", permissions = {
    // Android 12+: as permissões próprias de Bluetooth. Antes disso, procurar BLE exigia localização.
    @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
})
public class MidiPlugin extends Plugin {
    private static final ParcelUuid MIDI_SERVICE = ParcelUuid.fromString("03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
    private static final long SCAN_MS = 10000;

    private MidiManager manager;
    private final Map<String, MidiDevice> open = new HashMap<>();
    private final Map<String, String> names = new HashMap<>();
    private final Set<String> bleTried = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean started;
    private ScanCallback scanning;

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
        // Com a permissão já dada, procura o footswitch Bluetooth sem perguntar de novo.
        if (getPermissionState(bluetoothAlias()) == PermissionState.GRANTED) scan();
        call.resolve(inputs());
    }

    @PluginMethod
    public void list(PluginCall call) { call.resolve(inputs()); }

    // Procura e liga aparelhos Bluetooth MIDI por SCAN_MS. Resolve na hora com as entradas atuais; as que
    // forem achadas chegam no evento "inputs".
    @PluginMethod
    public void bluetooth(PluginCall call) {
        if (manager == null) { call.reject("Sem MIDI neste aparelho"); return; }
        if (getPermissionState(bluetoothAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(bluetoothAlias(), call, "bluetoothGranted");
            return;
        }
        scan();
        call.resolve(inputs());
    }

    @PermissionCallback
    private void bluetoothGranted(PluginCall call) {
        if (getPermissionState(bluetoothAlias()) != PermissionState.GRANTED) { call.reject("Sem permissão de Bluetooth"); return; }
        scan();
        call.resolve(inputs());
    }

    private static String bluetoothAlias() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "location"; }

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
        manager.openDevice(info, device -> attach(info, device), main);
    }

    private void attach(MidiDeviceInfo info, MidiDevice device) {
        if (device == null) return;
        String k = key(info);
        if (open.containsKey(k)) { try { device.close(); } catch (IOException ignored) { } return; }
        open.put(k, device);
        names.put(k, name(info));
        for (int i = 0; i < info.getOutputPortCount(); i++) {
            MidiOutputPort port = device.openOutputPort(i);
            if (port != null) port.connect(new Parser());
        }
        notifyListeners("inputs", inputs());
    }

    private void disconnect(String k) {
        MidiDevice d = open.remove(k);
        names.remove(k);
        if (d != null) try { d.close(); } catch (IOException ignored) { }
        notifyListeners("inputs", inputs());
    }

    // Só aparelhos que anunciam o serviço BLE MIDI. Um já ligado (ou tentado nesta busca) não é aberto de novo.
    private void scan() {
        if (scanning != null) return;
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = bm != null ? bm.getAdapter() : null;
        BluetoothLeScanner scanner = adapter != null && adapter.isEnabled() ? adapter.getBluetoothLeScanner() : null;
        if (scanner == null) return;
        bleTried.clear();
        scanning = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult r) { found(r.getDevice()); }
            @Override public void onBatchScanResults(List<ScanResult> rs) { for (ScanResult r : rs) found(r.getDevice()); }
            @Override public void onScanFailed(int code) { scanning = null; }
        };
        try {
            scanner.startScan(Collections.singletonList(new ScanFilter.Builder().setServiceUuid(MIDI_SERVICE).build()),
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanning);
        } catch (SecurityException e) { scanning = null; return; }
        ScanCallback cb = scanning;
        main.postDelayed(() -> { try { scanner.stopScan(cb); } catch (SecurityException ignored) { } if (scanning == cb) scanning = null; }, SCAN_MS);
    }

    private void found(BluetoothDevice dev) {
        if (dev == null || !bleTried.add(dev.getAddress())) return;
        try {
            manager.openBluetoothDevice(dev, device -> {
                if (device == null) return;
                MidiDeviceInfo info = device.getInfo();
                if (info.getOutputPortCount() == 0) { try { device.close(); } catch (IOException ignored) { } return; }
                attach(info, device);
            }, main);
        } catch (SecurityException ignored) { }
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
