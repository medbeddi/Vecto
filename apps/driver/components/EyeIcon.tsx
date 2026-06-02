import { View } from 'react-native';

export function EyeIcon({ open, color = '#888', size = 22 }: { open: boolean; color?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      {/* Forme de l'œil */}
      <View style={{
        width: size * 0.95, height: size * 0.58,
        borderRadius: size * 0.3,
        borderWidth: 1.5, borderColor: color,
        justifyContent: 'center', alignItems: 'center',
      }}>
        {/* Pupille — seulement si ouvert */}
        {open && (
          <View style={{
            width: size * 0.3, height: size * 0.3,
            borderRadius: size * 0.15,
            backgroundColor: color,
          }} />
        )}
      </View>

      {/* Barre diagonale si fermé */}
      {!open && (
        <View style={{
          position: 'absolute',
          width: size * 1.1, height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '-30deg' }],
        }} />
      )}
    </View>
  );
}
