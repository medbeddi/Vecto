const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Ajoute showOnLockScreen + turnScreenOn à la MainActivity
function withLockScreenActivity(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (!app?.activity) return config;
    for (const activity of app.activity) {
      const name = activity.$?.['android:name'] ?? '';
      if (name.includes('MainActivity')) {
        activity.$['android:showOnLockScreen'] = 'true';
        activity.$['android:turnScreenOn'] = 'true';
      }
    }
    return config;
  });
}

// Patche ExpoNotificationBuilder.kt pour ajouter setFullScreenIntent
function withFullScreenIntentPatch(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const builderPath = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'expo-notifications',
        'android',
        'src',
        'main',
        'java',
        'expo',
        'modules',
        'notifications',
        'notifications',
        'presentation',
        'builders',
        'ExpoNotificationBuilder.kt'
      );

      if (!fs.existsSync(builderPath)) {
        console.warn('[withFullScreenIntent] ExpoNotificationBuilder.kt introuvable');
        return config;
      }

      let content = fs.readFileSync(builderPath, 'utf8');

      if (content.includes('setFullScreenIntent')) {
        console.log('[withFullScreenIntent] Déjà patché, skip.');
        return config;
      }

      // Remplace le bloc setContentIntent par version + fullScreenIntent
      const oldBlock = `    val defaultAction =
      NotificationAction(NotificationResponse.DEFAULT_ACTION_IDENTIFIER, null, true)
    builder.setContentIntent(
      createNotificationResponseIntent(
        context,
        notification,
        defaultAction
      )
    )`;

      const newBlock = `    val defaultAction =
      NotificationAction(NotificationResponse.DEFAULT_ACTION_IDENTIFIER, null, true)
    val fsiIntent = createNotificationResponseIntent(context, notification, defaultAction)
    builder.setContentIntent(fsiIntent)
    builder.setFullScreenIntent(fsiIntent, true)
    builder.setCategory(NotificationCompat.CATEGORY_CALL)
    builder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)`;

      if (!content.includes(oldBlock)) {
        console.warn('[withFullScreenIntent] Bloc cible introuvable dans ExpoNotificationBuilder.kt');
        return config;
      }

      content = content.replace(oldBlock, newBlock);
      fs.writeFileSync(builderPath, content, 'utf8');
      console.log('[withFullScreenIntent] ExpoNotificationBuilder.kt patché avec succès');
      return config;
    },
  ]);
}

module.exports = function withFullScreenIntent(config) {
  config = withLockScreenActivity(config);
  config = withFullScreenIntentPatch(config);
  return config;
};
