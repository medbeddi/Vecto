import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

type Props = {
  url: string;
  visible: boolean;
  onClose: () => void;
};

const { width: SW, height: SH } = Dimensions.get('window');

export function ImageViewer({ url, visible, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission refusée',
          'Autorisez l\'accès à la galerie dans les paramètres pour télécharger cette image.'
        );
        return;
      }

      const filename = `vecto_${Date.now()}.jpg`;
      const localUri = FileSystem.cacheDirectory + filename;

      const downloadResult = await FileSystem.downloadAsync(url, localUri);
      if (downloadResult.status !== 200) {
        throw new Error(`HTTP ${downloadResult.status}`);
      }

      await MediaLibrary.saveToLibraryAsync(downloadResult.uri);
      Alert.alert('Image enregistrée', 'L\'image a été ajoutée à votre galerie.');
    } catch {
      Alert.alert('Erreur', 'Impossible de télécharger l\'image. Réessayez.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        <Image
          source={{ uri: url }}
          style={styles.image}
          resizeMode="contain"
        />

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.downloadBtn, downloading && styles.actionBtnDisabled]}
            onPress={handleDownload}
            disabled={downloading}
            activeOpacity={0.8}
          >
            {downloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.actionBtnText}>Télécharger</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.closeActionBtn]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.actionBtnText}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : (StatusBar.currentHeight ?? 24) + 12,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  image: {
    width: SW,
    height: SH * 0.75,
  },
  bottomBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    left: 24,
    right: 24,
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  downloadBtn: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  closeActionBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
