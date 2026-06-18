import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Nom trop court').max(80),
  phone: z
    .string()
    .min(8, 'Numéro trop court')
    .max(20, 'Numéro trop long')
    .regex(/^\+?[\d\s\-().]{7,20}$/, 'Format de numéro invalide'),
  password: z.string().regex(/^\d{4,}$/, 'Le mot de passe doit contenir uniquement des chiffres (min. 4)'),
});

export const loginSchema = z.object({
  phone: z
    .string()
    .min(8, 'Numéro trop court')
    .max(20, 'Numéro trop long')
    .regex(/^\+?[\d\s\-().]{7,20}$/, 'Format de numéro invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const statusSchema = z.object({
  status: z.enum(['in_progress', 'done', 'cancelled'], {
    errorMap: () => ({ message: "status doit être 'in_progress', 'done' ou 'cancelled'" }),
  }),
});

export const messageSchema = z
  .object({
    type: z.enum(['text', 'audio', 'image', 'location']),
    content: z.string().max(4096).optional(),
    meta: z
      .object({
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        label: z.string().max(255).optional(),
        r2Key: z.string().optional(),
        duration: z.number().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'text' && !data.content) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'content requis pour type text' });
    }
    if (data.type === 'location') {
      if (data.meta?.lat === undefined || data.meta?.lng === undefined) {
        ctx.addIssue({ code: 'custom', path: ['meta'], message: 'meta.lat et meta.lng requis pour type location' });
      }
    }
    if ((data.type === 'audio' || data.type === 'image') && !data.content) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'content (clé R2) requis pour audio/image' });
    }
  });

export const fcmTokenSchema = z.object({
  token: z.string().min(10, 'Token FCM invalide').max(512),
});

export const presignQuerySchema = z.object({
  type: z.enum(['audio', 'image']),
  ext: z.enum(['ogg', 'm4a', 'mp3', 'jpg', 'jpeg', 'png', 'webp', 'webm']),
});

export const documentsSchema = z.object({
  photo_driver:          z.string().optional(),
  carte_grise_front:     z.string().optional(),
  carte_grise_back:      z.string().optional(),
  carte_identite_front:  z.string().optional(),
  carte_identite_back:   z.string().optional(),
  matricule:             z.string().max(30).optional(),
  photo_vehicule:        z.string().optional(),
});

export const adminCreateDriverSchema = z.object({
  name:     z.string().min(2, 'Nom trop court').max(80),
  phone:    z.string().min(8).max(20).regex(/^\+?[\d\s\-().]{7,20}$/, 'Format de numéro invalide'),
  password: z.string().regex(/^\d{4,}$/, 'Le mot de passe doit contenir uniquement des chiffres (min. 4)'),
});
