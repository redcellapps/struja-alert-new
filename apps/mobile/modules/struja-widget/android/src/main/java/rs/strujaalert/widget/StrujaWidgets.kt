package rs.strujaalert.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider as dayNight
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

// The two widgets (BRIEF §7, docs/design/direction.md): flat fills, the lime accent for "Sve u
// redu", the status fills of the app's hero card, large radii, no outlines or shadows. Glance draws
// with the system font (Onest is not available to RemoteViews); every size is in sp, so the system's
// font scale applies. Light and dark through day/night colour providers, from the app's palettes.

private val LIME = Color(0xFFD4F84A)
private val NEAR_BLACK = Color(0xFF0B0B0D)
private val WHITE = Color(0xFFFFFFFF)

// status fills (the same in light and dark), and the text drawn on them
private fun fillOf(state: WidgetState?): ColorProvider = when (state) {
  WidgetState.CLEAR -> dayNight(LIME, LIME)
  WidgetState.UPCOMING -> dayNight(Color(0xFFFFC23D), Color(0xFFFFC23D))
  WidgetState.IMMINENT -> dayNight(Color(0xFFFF8A3D), Color(0xFFFF8A3D))
  WidgetState.ACTIVE -> dayNight(Color(0xFFDC2F34), Color(0xFFDC2F34))
  null -> dayNight(Color(0xFFFFFFFF), Color(0xFF18181B)) // the card, when there is nothing
}

private fun onFillOf(state: WidgetState?): ColorProvider = when (state) {
  WidgetState.ACTIVE -> dayNight(WHITE, WHITE)
  null -> dayNight(NEAR_BLACK, Color(0xFFF5F5F7))
  else -> dayNight(NEAR_BLACK, NEAR_BLACK)
}

// the medium widget's card and its text
private val CARD = dayNight(Color(0xFFFFFFFF), Color(0xFF18181B))
private val TEXT = dayNight(NEAR_BLACK, Color(0xFFF5F5F7))
private val TEXT_SECONDARY = dayNight(Color(0xFF5C5C66), Color(0xFF9A9AA3))

private const val SCHEME = "strujaalert://"

/** A tap opens the outage's detail when there is one, else Početna. */
private fun openIntent(context: Context, view: AddressView?): Intent {
  val url = view?.outage?.let { "${SCHEME}outage/${it.id}?addressId=${view.address.id}" } ?: SCHEME
  return Intent(Intent.ACTION_VIEW, Uri.parse(url))
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

@Composable
private fun SmallContent(snapshot: WidgetSnapshot?, now: Long) {
  val context = LocalContext.current
  val address = snapshot?.let { WidgetStore.ordered(it).firstOrNull() }
  val view = if (snapshot != null && address != null) WidgetStore.view(address, snapshot.labels, now) else null
  val fill = fillOf(view?.state)
  val on = onFillOf(view?.state)
  Box(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(fill)
      .cornerRadius(20.dp)
      .clickable(actionStartActivity(openIntent(context, view)))
      .padding(14.dp),
    contentAlignment = Alignment.BottomStart,
  ) {
    Column {
      Text(
        text = view?.address?.name ?: (snapshot?.labels?.appName ?: "Struja Alert"),
        style = TextStyle(color = on, fontSize = 12.sp),
        maxLines = 1,
      )
      Spacer(GlanceModifier.height(4.dp))
      Text(
        text = view?.title ?: (snapshot?.labels?.noAddress ?: "Dodajte adresu"),
        style = TextStyle(color = on, fontSize = 18.sp, fontWeight = FontWeight.Bold),
        maxLines = 2,
      )
      val detail = view?.detail ?: (snapshot?.labels?.open ?: "")
      if (detail.isNotEmpty()) {
        Spacer(GlanceModifier.height(2.dp))
        Text(text = detail, style = TextStyle(color = on, fontSize = 14.sp), maxLines = 1)
      }
      if (snapshot != null && view?.outage?.possible == true) {
        Text(text = snapshot.labels.possible, style = TextStyle(color = on, fontSize = 11.sp), maxLines = 1)
      }
    }
  }
}

@Composable
private fun AddressRow(snapshot: WidgetSnapshot, view: AddressView) {
  val context = LocalContext.current
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .padding(vertical = 4.dp)
      .clickable(actionStartActivity(openIntent(context, view))),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(modifier = GlanceModifier.defaultWeight()) {
      Text(
        text = view.address.name,
        style = TextStyle(color = TEXT, fontSize = 14.sp, fontWeight = FontWeight.Medium),
        maxLines = 1,
      )
      val line = if (view.outage?.possible == true && view.detail.isNotEmpty()) "${view.detail} · ${snapshot.labels.possible}" else view.detail
      if (line.isNotEmpty()) {
        Text(text = line, style = TextStyle(color = TEXT_SECONDARY, fontSize = 12.sp), maxLines = 1)
      }
    }
    Box(
      modifier = GlanceModifier
        .background(fillOf(view.state))
        .cornerRadius(12.dp)
        .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
      Text(
        text = view.title,
        style = TextStyle(color = onFillOf(view.state), fontSize = 12.sp, fontWeight = FontWeight.Bold),
        maxLines = 1,
      )
    }
  }
}

@Composable
private fun MediumContent(snapshot: WidgetSnapshot?, now: Long) {
  val context = LocalContext.current
  val addresses = snapshot?.let { WidgetStore.ordered(it).take(3) } ?: emptyList()
  Box(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(CARD)
      .cornerRadius(20.dp)
      .padding(horizontal = 14.dp, vertical = 10.dp),
    contentAlignment = Alignment.CenterStart,
  ) {
    if (snapshot == null || addresses.isEmpty()) {
      Column(modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(openIntent(context, null)))) {
        Text(text = snapshot?.labels?.appName ?: "Struja Alert", style = TextStyle(color = TEXT_SECONDARY, fontSize = 12.sp))
        Text(
          text = snapshot?.labels?.noAddress ?: "Dodajte adresu",
          style = TextStyle(color = TEXT, fontSize = 18.sp, fontWeight = FontWeight.Bold),
        )
      }
    } else {
      Column(modifier = GlanceModifier.fillMaxWidth()) {
        for (a in addresses) AddressRow(snapshot, WidgetStore.view(a, snapshot.labels, now))
      }
    }
  }
}

class StrujaSmallWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Single
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshot = WidgetStore.read(context)
    val now = System.currentTimeMillis()
    WidgetTick.schedule(context, snapshot, now)
    provideContent { SmallContent(snapshot, now) }
  }
}

class StrujaMediumWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Single
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshot = WidgetStore.read(context)
    val now = System.currentTimeMillis()
    WidgetTick.schedule(context, snapshot, now)
    provideContent { MediumContent(snapshot, now) }
  }
}

class StrujaSmallWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = StrujaSmallWidget()
}

class StrujaMediumWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = StrujaMediumWidget()
}
