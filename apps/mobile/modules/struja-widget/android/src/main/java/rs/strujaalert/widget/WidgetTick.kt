package rs.strujaalert.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// Re-renders the widgets at the next outage start or end, or at midnight, with the app process dead:
// one AlarmManager alarm, set again after every render and every snapshot. Exact when Android lets
// the app schedule exact alarms (the optional SCHEDULE_EXACT_ALARM permission, or the battery
// allowlist), else with the system's window. The server's data push and the app's own refresh
// re-render too; this is the part that needs nothing from them.
object WidgetTick {
  private const val REQUEST = 7001

  fun schedule(context: Context, snapshot: WidgetSnapshot?, now: Long) {
    val at = snapshot?.let { WidgetStore.nextBoundary(it, now) } ?: return
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pendingIntent(context)
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
  }

  fun cancel(context: Context) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(pendingIntent(context))
  }

  private fun pendingIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      REQUEST,
      Intent(context, WidgetTickReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  /** Draws every placed widget again (both sizes). */
  suspend fun updateAll(context: Context) {
    StrujaSmallWidget().updateAll(context)
    StrujaMediumWidget().updateAll(context)
  }
}

class WidgetTickReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val result = goAsync()
    CoroutineScope(Dispatchers.Default).launch {
      try {
        WidgetTick.updateAll(context) // each render schedules the next tick
      } finally {
        result.finish()
      }
    }
  }
}
