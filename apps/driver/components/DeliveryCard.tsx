import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BRAND, CARD, SURFACE } from '../lib/config';
import type { Delivery } from '../types';

type Props = {
  delivery: Delivery;
  onAccept: (delivery: Delivery) => void;
  accepting: boolean;
};

export function DeliveryCard({ delivery, onAccept, accepting }: Props) {
  const age = formatAge(delivery.createdAt);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.alias}>{delivery.clientAlias}</Text>
        <Text style={styles.age}>{age}</Text>
      </View>

      {delivery.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {delivery.description}
        </Text>
      ) : (
        <Text style={styles.noDesc}>Aucune description</Text>
      )}

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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4caf50',
    marginRight: 8,
  },
  alias: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  age: { color: '#888', fontSize: 12 },
  description: { color: '#ccc', fontSize: 14, marginBottom: 14, lineHeight: 20 },
  noDesc: { color: '#555', fontSize: 13, fontStyle: 'italic', marginBottom: 14 },
  btn: {
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
