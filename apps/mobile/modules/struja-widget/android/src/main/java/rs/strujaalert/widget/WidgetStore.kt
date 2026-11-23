package rs.strujaalert.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

// The snapshot the app hands over (src/widget/snapshot.ts): the saved addresses with their coming
// outages and every label in the person's language and script. Kept in SharedPreferences so the
// widget can draw with the app process dead. What the widget shows is decided HERE, at render time,
// from the outage times and the clock: that is how the status flips at the start and the end even
// when nothing in the app runs (WidgetTick re-renders at those moments).

data class WidgetOutage(val id: Int, val startsAt: Long, val endsAt: Long, val possible: Boolean)

data class WidgetAddress(
  val id: Int,
  val name: String,
  val primary: Boolean,
  val outages: List<WidgetOutage>,
)

data class WidgetLabels(
  val clear: String,
  val today: String,
  val tomorrow: String,
  val later: String,
  val active: String,
  val startsAt: String, // "počinje u {time}"
  val backAt: String, // "povratak u {time}"
  val possible: String,
  val noAddress: String,
  val open: String,
  val appName: String,
  val weekdays: List<String>, // Monday first
)

data class WidgetSnapshot(
  val updatedAt: Long,
  val labels: WidgetLabels,
  val addresses: List<WidgetAddress>,
)

enum class WidgetState { CLEAR, UPCOMING, IMMINENT, ACTIVE }

// What one address shows: the status word, the time line, the fill, where a tap goes.
data class AddressView(
  val address: WidgetAddress,
  val state: WidgetState,
  val title: String,
  val detail: String,
  val outage: WidgetOutage?,
)

object WidgetStore {
  private const val PREFS = "struja-widget"
  private const val KEY = "snapshot"
  const val ZONE = "Europe/Belgrade"
  private const val DAY_MS = 24 * 3600_000L

  fun write(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
  }

  fun read(context: Context): WidgetSnapshot? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
    return try {
      parse(raw)
    } catch (e: Exception) {
      null
    }
  }

  fun parse(raw: String): WidgetSnapshot {
    val o = JSONObject(raw)
    val l = o.getJSONObject("labels")
    val weekdays = l.optJSONArray("weekdays") ?: JSONArray()
    val labels = WidgetLabels(
      clear = l.optString("clear", "Sve u redu"),
      today = l.optString("today", "Danas bez struje"),
      tomorrow = l.optString("tomorrow", "Sutra bez struje"),
      later = l.optString("later", "Bez struje"),
      active = l.optString("active", "Bez struje"),
      startsAt = l.optString("startsAt", "počinje u {time}"),
      backAt = l.optString("backAt", "povratak u {time}"),
      possible = l.optString("possible", "Moguće pogođeno"),
      noAddress = l.optString("noAddress", "Dodajte adresu"),
      open = l.optString("open", "Otvorite aplikaciju"),
      appName = l.optString("appName", "Struja Alert"),
      weekdays = (0 until weekdays.length()).map { weekdays.getString(it) },
    )
    val addresses = o.optJSONArray("addresses") ?: JSONArray()
    val list = (0 until addresses.length()).map { i ->
      val a = addresses.getJSONObject(i)
      val outs = a.optJSONArray("outages") ?: JSONArray()
      WidgetAddress(
        id = a.getInt("id"),
        name = a.getString("name"),
        primary = a.optBoolean("primary", false),
        outages = (0 until outs.length()).map { j ->
          val x = outs.getJSONObject(j)
          WidgetOutage(x.getInt("id"), x.getLong("startsAt"), x.getLong("endsAt"), x.optBoolean("possible", false))
        }.sortedBy { it.startsAt },
      )
    }
    return WidgetSnapshot(o.optLong("updatedAt", 0L), labels, list)
  }

  /** The addresses in widget order: the primary one first, then the rest as saved. */
  fun ordered(s: WidgetSnapshot): List<WidgetAddress> =
    s.addresses.filter { it.primary } + s.addresses.filter { !it.primary }

  /** What an address shows at `now`. */
  fun view(address: WidgetAddress, labels: WidgetLabels, now: Long): AddressView {
    val active = address.outages.firstOrNull { it.startsAt <= now && now < it.endsAt }
    if (active != null) {
      return AddressView(address, WidgetState.ACTIVE, labels.active, labels.backAt.replace("{time}", hhmm(active.endsAt)), active)
    }
    val next = address.outages.firstOrNull { it.startsAt > now } ?: return AddressView(address, WidgetState.CLEAR, labels.clear, "", null)
    val state = if (next.startsAt - now < DAY_MS) WidgetState.IMMINENT else WidgetState.UPCOMING
    val today = dayOf(now)
    val day = dayOf(next.startsAt)
    val window = "${hhmm(next.startsAt)}–${hhmm(next.endsAt)}"
    val title = when {
      day == today -> labels.today
      day == dayOf(now + DAY_MS) -> labels.tomorrow
      else -> labels.later
    }
    val detail = if (day == today || day == dayOf(now + DAY_MS)) window else "${dayCaption(next.startsAt, labels)} $window"
    return AddressView(address, state, title, detail, next)
  }

  /** The next moment the picture may change: an outage start or end, or midnight (the day words). */
  fun nextBoundary(s: WidgetSnapshot, now: Long): Long {
    var next = nextMidnight(now)
    for (a in s.addresses) for (o in a.outages) {
      if (o.startsAt > now && o.startsAt < next) next = o.startsAt
      if (o.endsAt > now && o.endsAt < next) next = o.endsAt
    }
    return next
  }

  private fun calendar(ms: Long): Calendar =
    Calendar.getInstance(TimeZone.getTimeZone(ZONE)).also { it.timeInMillis = ms }

  fun hhmm(ms: Long): String {
    val c = calendar(ms)
    return "%02d:%02d".format(c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
  }

  /** The Belgrade date as a number: yyyyMMdd. */
  fun dayOf(ms: Long): Int {
    val c = calendar(ms)
    return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
  }

  private fun nextMidnight(now: Long): Long {
    val c = calendar(now)
    c.add(Calendar.DAY_OF_MONTH, 1)
    c.set(Calendar.HOUR_OF_DAY, 0)
    c.set(Calendar.MINUTE, 0)
    c.set(Calendar.SECOND, 0)
    c.set(Calendar.MILLISECOND, 0)
    return c.timeInMillis
  }

  /** "pon 2." for a later day. */
  private fun dayCaption(ms: Long, labels: WidgetLabels): String {
    val c = calendar(ms)
    val weekday = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7 // Monday = 0
    val name = labels.weekdays.getOrNull(weekday) ?: ""
    return "$name ${c.get(Calendar.DAY_OF_MONTH)}."
  }
}
