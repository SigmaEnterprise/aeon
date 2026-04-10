import React, { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, Upload, Zap, Globe, AtSign, User, Image as ImageIcon, AlignLeft } from 'lucide-react';
import { type NostrMetadata } from '@nostrify/nostrify';
import { useQueryClient } from '@tanstack/react-query';
import { useUploadFile } from '@/hooks/useUploadFile';
import { isAnimatedGif } from '@/lib/imgproxy';

// ─── Extended form schema ────────────────────────────────────────────────────
// NostrMetadata from @nostrify/nostrify covers the standard fields.
// We extend it here to include lud16 and display_name which the NSchema may
// not validate strictly, but are standard NIP-01 metadata fields.

const profileSchema = z.object({
  name:         z.string().optional(),
  display_name: z.string().optional(),
  about:        z.string().optional(),
  picture:      z.string().url({ message: 'Must be a valid URL' }).or(z.literal('')).optional(),
  banner:       z.string().url({ message: 'Must be a valid URL' }).or(z.literal('')).optional(),
  website:      z.string().url({ message: 'Must be a valid URL' }).or(z.literal('')).optional(),
  nip05:        z.string().optional(),
  lud16:        z.string().optional(),
  lud06:        z.string().optional(),
  bot:          z.boolean().optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

// ─── EditProfileForm ─────────────────────────────────────────────────────────

export const EditProfileForm: React.FC = () => {
  const queryClient = useQueryClient();

  const { user, metadata } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name:         '',
      display_name: '',
      about:        '',
      picture:      '',
      banner:       '',
      website:      '',
      nip05:        '',
      lud16:        '',
      lud06:        '',
      bot:          false,
    },
  });

  // Populate form when metadata is loaded
  useEffect(() => {
    if (metadata) {
      form.reset({
        name:         metadata.name         || '',
        display_name: metadata.display_name || '',
        about:        metadata.about        || '',
        picture:      metadata.picture      || '',
        banner:       metadata.banner       || '',
        website:      metadata.website      || '',
        nip05:        metadata.nip05        || '',
        lud16:        metadata.lud16        || '',
        lud06:        metadata.lud06        || '',
        bot:          metadata.bot          || false,
      });
    }
  }, [metadata, form]);

  // Upload file and set field value
  const uploadImageField = async (file: File, field: 'picture' | 'banner') => {
    try {
      const [[, url]] = await uploadFile(file);
      form.setValue(field, url, { shouldDirty: true });
      toast({
        title: 'Uploaded!',
        description: `${field === 'picture' ? 'Profile picture' : 'Banner'} uploaded successfully`,
      });
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: (err as Error).message ?? 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const onSubmit = async (values: ProfileFormValues) => {
    if (!user) {
      toast({ title: 'Not logged in', variant: 'destructive' });
      return;
    }

    try {
      // Merge with any existing metadata keys not covered by our form
      // (e.g. lud06, custom fields set by other clients)
      const merged: Record<string, unknown> = { ...(metadata as Record<string, unknown> ?? {}) };

      // Apply form values, removing empty strings so they don't overwrite with blank
      for (const [key, val] of Object.entries(values)) {
        if (val === '' || val === undefined) {
          delete merged[key];
        } else {
          merged[key] = val;
        }
      }

      await publishEvent({
        kind: 0,
        content: JSON.stringify(merged),
      });

      queryClient.invalidateQueries({ queryKey: ['logins'] });
      queryClient.invalidateQueries({ queryKey: ['nostr', 'author', user.pubkey] });

      toast({ title: 'Profile updated!', description: 'Your changes have been published to Nostr.' });
    } catch (err) {
      toast({
        title: 'Failed to save',
        description: (err as Error).message ?? 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Identity ── */}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <User className="h-3.5 w-3.5" />Identity
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username / Handle</FormLabel>
                <FormControl>
                  <Input placeholder="alice" {...field} />
                </FormControl>
                <FormDescription>Short handle used by Nostr clients (no spaces).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display Name</FormLabel>
                <FormControl>
                  <Input placeholder="Alice Wonderland" {...field} />
                </FormControl>
                <FormDescription>Longer, richer name shown in feeds and profiles.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="about"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2"><AlignLeft className="h-3.5 w-3.5" />Bio</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Tell others about yourself…"
                  className="resize-none min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <FormDescription>A short description shown on your profile.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Images ── */}
        <div className="space-y-1 pt-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <ImageIcon className="h-3.5 w-3.5" />Images
          </h3>
          <p className="text-xs text-muted-foreground">
            Supports JPEG, PNG, WebP, and animated GIFs. Upload via Blossom or paste a direct URL.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="picture"
            render={({ field }) => (
              <ImageUploadField
                field={field}
                label="Profile Picture"
                placeholder="https://example.com/avatar.gif"
                description="Square avatar image. Animated GIFs are fully supported."
                previewType="square"
                onUpload={(file) => uploadImageField(file, 'picture')}
              />
            )}
          />

          <FormField
            control={form.control}
            name="banner"
            render={({ field }) => (
              <ImageUploadField
                field={field}
                label="Banner / Header Image"
                placeholder="https://example.com/banner.gif"
                description="Wide banner (~1024×256). Animated GIFs are fully supported."
                previewType="wide"
                onUpload={(file) => uploadImageField(file, 'banner')}
              />
            )}
          />
        </div>

        {/* ── Links ── */}
        <div className="space-y-1 pt-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Globe className="h-3.5 w-3.5" />Links & Verification
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Website</FormLabel>
                <FormControl>
                  <Input placeholder="https://yoursite.com" {...field} />
                </FormControl>
                <FormDescription>Personal website or social link.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nip05"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5"><AtSign className="h-3.5 w-3.5" />NIP-05 Identifier</FormLabel>
                <FormControl>
                  <Input placeholder="you@example.com" {...field} />
                </FormControl>
                <FormDescription>Verified Nostr address (email-style).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Lightning ── */}
        <div className="space-y-1 pt-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />Lightning Address
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="lud16"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-yellow-500" />Lightning Address (lud16)</FormLabel>
                <FormControl>
                  <Input placeholder="you@wallet.com" {...field} />
                </FormControl>
                <FormDescription>
                  Email-style Lightning address for receiving zaps (e.g. <span className="font-mono">you@walletofsatoshi.com</span>).
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lud06"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-yellow-400" />LNURL (lud06)</FormLabel>
                <FormControl>
                  <Input placeholder="LNURL1..." {...field} />
                </FormControl>
                <FormDescription>
                  Bech32-encoded LNURL pay endpoint (advanced). Leave blank if using lud16.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Other ── */}
        <FormField
          control={form.control}
          name="bot"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Bot Account</FormLabel>
                <FormDescription>
                  Mark this account as automated or a bot. Clients may display it differently.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full md:w-auto"
          disabled={isPending || isUploading}
        >
          {(isPending || isUploading) ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
          ) : 'Save Profile'}
        </Button>
      </form>
    </Form>
  );
};

// ─── ImageUploadField ─────────────────────────────────────────────────────────

interface ImageUploadFieldProps {
  field: {
    value: string | undefined;
    onChange: (value: string) => void;
    name: string;
    onBlur: () => void;
  };
  label: string;
  placeholder: string;
  description: string;
  previewType: 'square' | 'wide';
  onUpload: (file: File) => void;
}

const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  field,
  label,
  placeholder,
  description,
  previewType,
  onUpload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = field.value || '';
  const isGif = isAnimatedGif(previewUrl);

  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <div className="flex flex-col gap-2">
        <FormControl>
          <Input
            placeholder={placeholder}
            name={field.name}
            value={field.value ?? ''}
            onChange={e => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FormControl>

        <div className="flex items-start gap-3">
          {/* Upload button */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) { onUpload(file); e.target.value = ''; }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </Button>
          </div>

          {/* Live preview */}
          {previewUrl && (
            <div
              className={`rounded-lg overflow-hidden border bg-muted shrink-0 ${
                previewType === 'square' ? 'h-16 w-16' : 'h-16 w-32'
              }`}
            >
              {/* Use <img> directly — not proxied — so GIFs animate in preview */}
              <img
                src={previewUrl}
                alt={`${label} preview`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              {isGif && (
                <div className="absolute -mt-4 ml-1">
                  <span className="text-[9px] bg-black/60 text-white px-1 py-0.5 rounded font-mono">GIF</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <FormDescription>{description}</FormDescription>
      <FormMessage />
    </FormItem>
  );
};
