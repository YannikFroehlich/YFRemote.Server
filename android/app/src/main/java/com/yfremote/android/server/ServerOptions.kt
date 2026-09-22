package com.yfremote.android.server

// Android-Aequivalente zu Configuration/ClipboardOptions.cs und FileTransferOptions.cs - gleiche
// Standardwerte, aber ohne appsettings.json-Bindung (siehe PLAN.md: kein appsettings-Aequivalent
// vorgesehen, feste Defaults reichen fuer den Prototyp).
data class ClipboardOptions(
    val maxImageSizeBytes: Long = 20L * 1024 * 1024,
    val maxTextLength: Int = 200_000,
)

data class FileTransferOptions(
    val maxFileSizeBytes: Long = 200L * 1024 * 1024,
)
