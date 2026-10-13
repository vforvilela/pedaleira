package com.tonesmith.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

// Serviço em primeiro plano enquanto o som está ligado. Sem ele, o Android corta o microfone (a entrada da
// guitarra) assim que o app sai da frente: trocar de app, tela apagada, Voltar. A notificação é obrigatória
// e serve de atalho de volta ao app.
public class AudioService extends Service {
    static final String CHANNEL = "tonesmith.audio";
    static final int ID = 1;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "ToneSmith", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Som ligado");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
            .setContentTitle("ToneSmith")
            .setContentText(intent != null && intent.hasExtra("text") ? intent.getStringExtra("text") : "Tocando")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID, n);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
