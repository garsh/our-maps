package com.google.ourmaps.utils

import android.content.Context
import android.content.SharedPreferences

object CollaboratorManager {
    private const val PREFS_NAME = "collaborators"
    private const val KEY_EMAILS = "shared_emails"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun addEmail(context: Context, email: String) {
        val prefs = getPrefs(context)
        val emails = getEmails(context).toMutableSet()
        emails.add(email)
        prefs.edit().putStringSet(KEY_EMAILS, emails).apply()
    }

    fun getEmails(context: Context): Set<String> {
        return getPrefs(context).getStringSet(KEY_EMAILS, emptySet()) ?: emptySet()
    }
}
