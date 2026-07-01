const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Modifie MainApplication.kt pour étendre VoiceApplicationProxy (requis par @twilio/voice-react-native-sdk)
// Sans ça : NullPointerException dans VoiceApplicationProxy.getJSEventEmitter() au démarrage
module.exports = function withTwilioVoice(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const packageName = config.android?.package ?? 'com.medbeddi.vecto.driver';
      const packagePath = packageName.replace(/\./g, '/');

      const mainAppPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java',
        packagePath,
        'MainApplication.kt'
      );

      if (!fs.existsSync(mainAppPath)) {
        console.warn('[withTwilioVoice] MainApplication.kt introuvable :', mainAppPath);
        return config;
      }

      let content = fs.readFileSync(mainAppPath, 'utf8');

      if (content.includes('VoiceApplicationProxy')) {
        console.log('[withTwilioVoice] Déjà patché, skip.');
        return config;
      }

      // Ajouter l'import Twilio après le dernier import existant
      content = content.replace(
        /(import [^\n]+\n)(?!import)/,
        '$1import com.twiliovoicereactnative.VoiceApplicationProxy\n'
      );

      // Remplacer Application() par VoiceApplicationProxy() comme superclasse
      content = content.replace(
        /class MainApplication\s*:\s*Application\(\)/,
        'class MainApplication : VoiceApplicationProxy()'
      );

      fs.writeFileSync(mainAppPath, content, 'utf8');
      console.log('[withTwilioVoice] MainApplication.kt patché — superclasse VoiceApplicationProxy');
      return config;
    },
  ]);
};
