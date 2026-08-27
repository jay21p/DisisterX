package com.jay.bharatsetu;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_main);

        // System bars
        ViewCompat.setOnApplyWindowInsetsListener(
                findViewById(R.id.main),
                (v, insets) -> {

                    Insets systemBars = insets.getInsets(
                            WindowInsetsCompat.Type.systemBars()
                    );

                    v.setPadding(
                            systemBars.left,
                            systemBars.top,
                            systemBars.right,
                            systemBars.bottom
                    );

                    return insets;
                }
        );

        // =========================
        // OFFLINE MESSAGE - BITCHAT
        // =========================

        Button offlineMessage =
                findViewById(R.id.offlinemessage);

        offlineMessage.setOnClickListener(v -> {

            try {

                Intent intent = new Intent();

                intent.setClassName(
                        "com.bitchat.droid",
                        "com.bitchat.android.MainActivity"
                );

                startActivity(intent);

            } catch (Exception e) {

                Toast.makeText(
                        MainActivity.this,
                        "BitChat is not installed",
                        Toast.LENGTH_SHORT
                ).show();
            }
        });


        // =========================
        // EMERGENCY CALL - 112
        // =========================

        Button emergencyCall =
                findViewById(R.id.emergencycall);

        emergencyCall.setOnClickListener(v -> {

            Intent intent = new Intent(
                    Intent.ACTION_DIAL
            );

            intent.setData(
                    Uri.parse("tel:112")
            );

            startActivity(intent);
        });
    }
}