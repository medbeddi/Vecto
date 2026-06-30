import { create } from 'zustand';
import { Voice, Call, CallInvite } from '@twilio/voice-react-native-sdk';
import { api } from '../lib/api';

export type CallPhase = 'idle' | 'connecting' | 'ringing' | 'connected' | 'disconnected';

type VoiceState = {
  voice: Voice | null;
  call: Call | null;
  incomingInvite: CallInvite | null;
  phase: CallPhase;
  muted: boolean;
  error: string | null;

  init: () => Promise<void>;
  makeCall: (to: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
};

let voiceInstance: Voice | null = null;

export const useVoiceStore = create<VoiceState>((set, get) => ({
  voice: null,
  call: null,
  incomingInvite: null,
  phase: 'idle',
  muted: false,
  error: null,

  init: async () => {
    if (voiceInstance) return;
    try {
      const { token } = await api<{ token: string; identity: string }>('/api/calls/token');
      voiceInstance = new Voice();

      voiceInstance.on(Voice.Event.CallInvite, (invite: CallInvite) => {
        set({ incomingInvite: invite, phase: 'ringing' });
      });

      await voiceInstance.register(token);
      set({ voice: voiceInstance });
    } catch (err: any) {
      set({ error: err?.message ?? 'VOICE_INIT_FAILED' });
    }
  },

  makeCall: async (to: string) => {
    const { voice } = get();
    if (!voice) return;
    try {
      set({ phase: 'connecting', error: null });
      const { token } = await api<{ token: string; identity: string }>('/api/calls/token');
      const call = await voice.connect(token, { params: { To: to } });

      call.on(Call.Event.Ringing, () => set({ phase: 'ringing' }));
      call.on(Call.Event.Connected, () => set({ phase: 'connected' }));
      call.on(Call.Event.Disconnected, () => set({ phase: 'disconnected', call: null, muted: false }));
      call.on(Call.Event.ConnectFailure, (err) => set({ phase: 'disconnected', call: null, error: err?.message }));

      set({ call });
    } catch (err: any) {
      set({ phase: 'disconnected', error: err?.message ?? 'CALL_FAILED' });
    }
  },

  acceptIncoming: async () => {
    const { incomingInvite } = get();
    if (!incomingInvite) return;
    try {
      const call = await incomingInvite.accept();
      call.on(Call.Event.Connected, () => set({ phase: 'connected' }));
      call.on(Call.Event.Disconnected, () => set({ phase: 'disconnected', call: null, muted: false, incomingInvite: null }));
      set({ call, incomingInvite: null, phase: 'connected' });
    } catch (err: any) {
      set({ error: err?.message ?? 'ACCEPT_FAILED', incomingInvite: null, phase: 'idle' });
    }
  },

  rejectIncoming: async () => {
    const { incomingInvite } = get();
    if (!incomingInvite) return;
    await incomingInvite.reject();
    set({ incomingInvite: null, phase: 'idle' });
  },

  hangUp: async () => {
    const { call, incomingInvite } = get();
    if (call) await call.disconnect();
    if (incomingInvite) await incomingInvite.reject();
    set({ call: null, incomingInvite: null, phase: 'idle', muted: false });
  },

  toggleMute: async () => {
    const { call, muted } = get();
    if (!call) return;
    await call.mute(!muted);
    set({ muted: !muted });
  },
}));
