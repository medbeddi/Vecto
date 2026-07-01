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

      // Ajouter l'import avant la déclaration de classe
      content = content.replace(
        'class MainApplication :',
        'import com.twiliovoicereactnative.VoiceApplicationProxy\n\nclass MainApplication :'
      );

      // Initialiser VoiceApplicationProxy(this) dans onCreate() après super.onCreate()
      // VoiceApplicationProxy n'est pas une superclasse mais un objet qui prend l'Application en paramètre
      content = content.replace(
        'super.onCreate()',
        'super.onCreate()\n    VoiceApplicationProxy(this)'
      );

      fs.writeFileSync(mainAppPath, content, 'utf8');
      console.log('[withTwilioVoice] MainApplication.kt patché — VoiceApplicationProxy initialisé dans onCreate()');
      return config;
    },
  ]);
};
