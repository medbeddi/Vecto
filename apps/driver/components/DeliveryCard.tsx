import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BRAND, CARD } from '../lib/config';
import type { Delivery } from '../types';

type Props = {
  delivery: Delivery;
  onAccept: (delivery: Delivery) => void;
  accepting: boolean;
};

const TYPE_ICON: Record<string, string> = {
  audio: '🎙️',
  location: '📍',
  image: '🖼️',
  text: '💬',
};

const TYPE_LABEL: Record<string, string> = {
  audio: 'Message vocal',
  location: 'Localisation',
  image: 'Photo',
  text: 'Texte',
};

const TYPE_COLOR: Record<string, string> = {
  audio: '#E91E63',
  location: '#2196F3',
  image: '#9C27B0',
  text: '#607D8B',
};

export function DeliveryCard({ delivery, onAccept, accepting }: Props) {
  const age = formatAge(delivery.createdAt);
  const mediaType = delivery.initialMediaType ?? 'text';
  const icon = TYPE_ICON[mediaType] ?? '💬';
  const label = TYPE_LABEL[mediaType] ?? mediaType;
  const color = TYPE_COLOR[mediaType] ?? '#607D8B';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.alias}>{delivery.clientAlias}</Text>
        <Text style={styles.age}>{age}</Text>
      </View>

      <View style={[styles.typeBadge, { backgroundColor: color + '22', borderColor: color + '66' }]}>
        <Text style={styles.typeIcon}>{icon}</Text>
        <Text style={[styles.typeLabel, { color }]}>{label}</Text>
      </View>

      {delivery.description && mediaType === 'text' ? (
        <Text style={styles.description} numberOfLines={2}>{delivery.description}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.btn, accepting && styles.btnDisabled]}
        onPress={() => onAccept(delivery)}
        disabled={accepting}
        activeOpacity={0.75}
      >
        <Text style={styles.btnText}>
          {accepting ? 'Acceptation...' : 'Accepter la course'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function formatAge(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.floor(m / 60)} h`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: BRAND,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50', marginRight: 8 },
  alias: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  age: { color: '#888', fontSize: 12 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  typeIcon: { fontSize: 16 },
  typeLabel: { fontSize: 13, fontWeight: '700' },
  description: { color: '#ccc', fontSize: 14, lineHeight: 20 },
  btn: {
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
