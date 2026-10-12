# Vendora Flutter app (paused)

Started before we switched to the web version. What's here:

- `lib/models/models.dart`: all data models (offline JSON)
- `lib/services/command_parser.dart`: Dart port of the tested voice parser (`server/src/parser.js`)
- `lib/services/finance.dart`: Business Score + loan maths (port of `server/src/finance.js`)
- `lib/services/wema_api.dart`: Wema layer (mock + HTTP to the Vendora server)

Not done yet: app state, screens, platform setup. These files have not been compiled (no Flutter SDK was available
in the build environment). When we resume, the web app's screens (`web/src/screens`) are the blueprint.
