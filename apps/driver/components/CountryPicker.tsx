import { useState } from 'react';
import {
  FlatList, Modal, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { BRAND } from '../lib/config';

export type Country = { flag: string; name: string; dial: string };

export const COUNTRIES: Country[] = [
  { flag: '🇲🇷', name: 'Mauritanie', dial: '+222' },
  { flag: '🇹🇳', name: 'Tunisie', dial: '+216' },
  { flag: '🇲🇦', name: 'Maroc', dial: '+212' },
  { flag: '🇩🇿', name: 'Algérie', dial: '+213' },
  { flag: '🇸🇳', name: 'Sénégal', dial: '+221' },
  { flag: '🇲🇱', name: 'Mali', dial: '+223' },
  { flag: '🇨🇮', name: 'Côte d\'Ivoire', dial: '+225' },
  { flag: '🇬🇳', name: 'Guinée', dial: '+224' },
  { flag: '🇧🇫', name: 'Burkina Faso', dial: '+226' },
  { flag: '🇳🇬', name: 'Nigeria', dial: '+234' },
  { flag: '🇬🇭', name: 'Ghana', dial: '+233' },
  { flag: '🇨🇲', name: 'Cameroun', dial: '+237' },
  { flag: '🇪🇬', name: 'Égypte', dial: '+20' },
  { flag: '🇱🇾', name: 'Libye', dial: '+218' },
  { flag: '🇸🇩', name: 'Soudan', dial: '+249' },
  { flag: '🇫🇷', name: 'France', dial: '+33' },
  { flag: '🇧🇪', name: 'Belgique', dial: '+32' },
  { flag: '🇪🇸', name: 'Espagne', dial: '+34' },
];

type Props = {
  selected: Country;
  onSelect: (c: Country) => void;
  light?: boolean;
};

export default function CountryPicker({ selected, onSelect, light }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.dial.includes(query)
  );

  return (
    <>
      <TouchableOpacity
        style={[s.trigger, light && s.triggerLight]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={s.flag}>{selected.flag}</Text>
        <Text style={[s.dial, light && s.dialLight]}>{selected.dial}</Text>
        <Text style={[s.arrow, light && s.arrowLight]}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.title}>Choisir le pays</Text>
            <TextInput
              style={s.search}
              placeholder="Rechercher..."
              placeholderTextColor="#555"
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.dial}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.row, item.dial === selected.dial && s.rowSelected]}
                  onPress={() => { onSelect(item); setOpen(false); setQuery(''); }}
                >
                  <Text style={s.rowFlag}>{item.flag}</Text>
                  <Text style={s.rowName}>{item.name}</Text>
                  <Text style={s.rowDial}>{item.dial}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={s.cancel} onPress={() => { setOpen(false); setQuery(''); }}>
              <Text style={s.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 14,
    borderRightWidth: 1, borderRightColor: '#2a2a2a',
  },
  triggerLight: { borderRightColor: '#EBEBEB' },
  flag: { fontSize: 20 },
  dial: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dialLight: { color: '#1A1A1A' },
  arrow: { color: '#666', fontSize: 10 },
  arrowLight: { color: '#888' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '80%',
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  search: {
    backgroundColor: '#111', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 15, marginBottom: 12,
    borderWidth: 1, borderColor: '#333',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#222',
  },
  rowSelected: { backgroundColor: '#0a2a1a' },
  rowFlag: { fontSize: 22 },
  rowName: { flex: 1, color: '#fff', fontSize: 15 },
  rowDial: { color: '#666', fontSize: 14 },
  cancel: { marginTop: 14, alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: BRAND, fontSize: 15, fontWeight: '600' },
});
