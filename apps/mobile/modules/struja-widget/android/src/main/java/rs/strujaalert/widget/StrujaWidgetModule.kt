package rs.strujaalert.widget

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking

// The JS side of the widget (apps/mobile/modules/struja-widget/index.ts): the app hands over a
// snapshot whenever its data changed (a sync, a push, the 15-minute refresh); the widgets redraw.
class StrujaWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StrujaWidget")

    AsyncFunction("setSnapshot").Coroutine { json: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("no context")
      WidgetStore.parse(json) // a broken snapshot is refused, the old one stays
      WidgetStore.write(context, json)
      WidgetTick.updateAll(context)
    }

    // (the zero-argument Coroutine overload is ambiguous in this Expo version: a plain async function)
    AsyncFunction("clearSnapshot") {
      val context = appContext.reactContext ?: throw IllegalStateException("no context")
      WidgetStore.clear(context)
      WidgetTick.cancel(context)
      runBlocking { WidgetTick.updateAll(context) }
    }
  }
}
