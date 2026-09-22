package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/FileUploadResponse.cs.
@Serializable
data class FileUploadResponse(
    val success: Boolean,
    val fileName: String? = null,
    val error: String? = null,
) {
    companion object {
        fun ok(fileName: String) = FileUploadResponse(success = true, fileName = fileName)

        fun fail(error: String) = FileUploadResponse(success = false, error = error)
    }
}
