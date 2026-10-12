import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import './ui/styles.css';
import { App } from './ui/app';

// The painted station codes are drawn to canvas, so the font must be ready first.
Promise.all([
  document.fonts.load('600 64px "Chakra Petch"'),
  document.fonts.load('500 16px "Chakra Petch"'),
]).finally(() => {
  const app = new App(document.getElementById('app')!);
  (window as unknown as { railflow: App }).railflow = app;
});
