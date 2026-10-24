// App entry. Background tasks must be defined as soon as the bundle loads: when Android runs the
// sync task after the app was swiped away, it starts JS headless and no screen (or _layout) renders.
import './src/lib/background';
import 'expo-router/entry';
