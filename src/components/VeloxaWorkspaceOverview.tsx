'use client';

import React from 'react';
import { ArrowRight, Check, CircleHelp, FileText, Image as ImageIcon, Layers, Link2, Play, Send, Sparkles, Ticket } from 'lucide-react';
import type { BrandProfile, ChannelConnectionState, ContentDraft, ContentFormat } from '@/lib/veloxa-types';
import { firstPostProgress } from '@/lib/first-post-guide';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import { VeloxaFirstPostGuide } from './VeloxaFirstPostGuide';

const channels = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube_shorts: 'YouTube Shorts' };
const draftLabels: Record<ContentDraft['status'], string> = {
  draft: 'Draf', repairing: 'Diproses', approved: 'Siap ditinjau', scheduled: 'Dijadwalkan',
  published: 'Terbit', publishing: 'Sedang mengirim', publish_queued: 'Siap dilanjutkan',
  publish_failed: 'Gagal terbit', partially_published: 'Sebagian terbit', needs_attention: 'Perlu diperiksa',
};
const needsAttention = (draft: ContentDraft) => ['publish_failed', 'partially_published', 'needs_attention'].includes(draft.status);
const formats = [
  { id: 'single_post', label: 'Post tunggal', detail: 'Satu gambar', ratio: '4:5', icon: ImageIcon },
  { id: 'carousel', label: 'Carousel', detail: 'Lima slide', ratio: '4:5', icon: Layers },
  { id: 'short_video', label: 'Reels', detail: 'Video vertikal', ratio: '9:16', icon: Play },
] as const;

interface Props {
  brand: BrandProfile;
  postsUsed: number;
  quota: number;
  connections: ChannelConnectionState[];
  connectionsVerified: boolean;
  drafts: ContentDraft[];
  onStudio: () => void;
  onCreateContent: (format: ContentFormat) => void;
  onEditProfile: () => void;
  onConnections: () => void;
  firstPost?: {
    historyReady: boolean;
    canAssignAccount: boolean;
    disabled: boolean;
    onConnect: () => void;
    onAssign: () => void;
    onCollection: () => void;
    onReview: (draftId: string) => void;
  };
}

export function VeloxaWorkspaceOverview(props: Props) {
  const { t, locale } = useWorkspaceCopy(workspaceCatalog);
  const number = new Intl.NumberFormat(locale);
  const connected = props.connections.filter(item => item.connected);
  const published = props.drafts.filter(item => item.status === 'published').length;
  const hasFailures = props.drafts.some(needsAttention);
  const firstPost = props.firstPost;
  const progress = props.connectionsVerified && firstPost
    ? firstPostProgress(props.brand, connected, props.drafts, firstPost.historyReady)
    : null;
  const metrics = [
    { icon: Link2, label: 'Akun terhubung', value: props.connectionsVerified || connected.length ? number.format(connected.length) : '—', note: !props.connectionsVerified ? 'Status akun belum diperbarui' : '' },
    { icon: FileText, label: 'Belum terbit', value: number.format(props.drafts.length - published), note: hasFailures ? 'Ada publikasi yang perlu diperiksa' : '' },
    { icon: Send, label: 'Konten terbit', value: number.format(published) },
    { icon: Ticket, label: 'Kuota publikasi', value: `${number.format(props.postsUsed)} / ${number.format(props.quota)}` },
  ];

  return <div className="ws-overview-overview" data-testid="workspace-clean-overview">
    {firstPost && progress && (!progress.hasAccount || (firstPost.historyReady && !progress.hasPublished)) ? (
      <VeloxaFirstPostGuide
        progress={progress}
        canAssignAccount={firstPost.canAssignAccount}
        hasDrafts={props.drafts.length > 0}
        disabled={firstPost.disabled}
        onConnect={firstPost.onConnect}
        onAssign={firstPost.onAssign}
        onProfile={props.onEditProfile}
        onDraft={() => props.onCreateContent('single_post')}
        onCollection={firstPost.onCollection}
        onReview={firstPost.onReview}
      />
    ) : <section className="ws-overview-hero" aria-labelledby="overview-create-title">
      <div className="ws-overview-hero-copy">
        <p className="ws-overview-eyebrow"><Sparkles size={15} aria-hidden="true"/>{t('Mulai membuat')}</p>
        <h2 id="overview-create-title">{t('Buat konten baru')}</h2>
        <p className="ws-overview-lede">{t('Buat post, carousel, atau Reels untuk bisnis Anda.')}</p>
        <button type="button" className="ws-overview-hero-button" onClick={props.onStudio}>{t('Buka Content Studio')}<ArrowRight size={16} aria-hidden="true" className="ws-overview-arrow"/></button>
      </div>
      <div className="ws-overview-art" aria-hidden="true">
        <span className="ws-overview-orbit"/>
        <span className="ws-overview-art-back"><Layers/></span>
        <span className="ws-overview-art-front"><ImageIcon/><i/><i/></span>
        <span className="ws-overview-art-play"><Play fill="currentColor"/></span>
        <Sparkles className="ws-overview-art-sparkle"/>
      </div>
    </section>}

    <section aria-labelledby="overview-formats-title">
      <h2 id="overview-formats-title" className="ws-overview-section-title">{t('Pilih format')}</h2>
      <div className="ws-overview-formats">{formats.map((format, index) => <button key={format.id} type="button" onClick={() => props.onCreateContent(format.id)} className="ws-overview-format" data-variation={index}>
        <span className="ws-overview-format-icon"><format.icon size={20} strokeWidth={1.75} aria-hidden="true"/></span>
        <span className="ws-overview-format-text"><strong>{t(format.label)}</strong><span>{t(format.detail)} · <bdi>{format.ratio}</bdi></span></span>
        <ArrowRight size={16} aria-hidden="true" className="ws-overview-arrow"/>
      </button>)}</div>
    </section>

    <section aria-labelledby="overview-summary-title">
      <h2 id="overview-summary-title" className="ws-overview-section-title">{t('Ringkasan bisnis')}</h2>
      <div className="ws-overview-metrics">{metrics.map(metric => <article key={metric.label} className="ws-overview-metric">
        <p><metric.icon size={16} strokeWidth={1.75} aria-hidden="true"/>{t(metric.label)}</p>
        <strong><bdi>{metric.value}</bdi></strong>
        {metric.note && <span>{t(metric.note)}</span>}
      </article>)}</div>
    </section>

    <div className="ws-overview-details">
      <section className="ws-overview-card" aria-labelledby="overview-recent-title">
        <div className="ws-overview-card-header"><h2 id="overview-recent-title">{t('Konten terbaru')}</h2><button type="button" onClick={props.onStudio} className="ws-overview-text-button">{t('Buka Studio')} <ArrowRight size={15} aria-hidden="true" className="ws-overview-arrow"/></button></div>
        {props.drafts.length ? <ul className="ws-overview-rows">{props.drafts.slice(0, 5).map(draft => {
          const format = formats.find(item => item.id === draft.format) || formats[0];
          return <li key={draft.id}><div className="ws-overview-draft-row">
            <span className="ws-overview-row-icon"><format.icon size={18} aria-hidden="true"/></span>
            <span className="ws-overview-row-text"><strong dir="auto">{draft.title}</strong><small>{t(format.label)}</small></span>
            <span className="ws-overview-badge" data-state={draft.status === 'published' ? 'success' : needsAttention(draft) ? 'attention' : undefined}>{t(draftLabels[draft.status])}</span>
          </div></li>;
        })}</ul> : <div className="ws-overview-empty"><span className="ws-overview-row-icon"><FileText size={19} aria-hidden="true"/></span><strong>{t('Belum ada konten')}</strong><p>{t('Draf dan publikasi bisnis ini akan muncul di sini.')}</p></div>}
      </section>

      <section className="ws-overview-card" aria-labelledby="overview-social-title">
        <div className="ws-overview-card-header"><h2 id="overview-social-title">{t('Akun sosial')}</h2><Link2 size={18} className="ws-overview-subtle-icon" aria-hidden="true"/></div>
        {connected.length ? <ul className="ws-overview-rows">{connected.slice(0, 4).map(account => <li key={account.connectionId || account.channel} className="ws-overview-draft-row">
          <span className="ws-overview-row-icon" aria-hidden="true">{channels[account.channel].slice(0, 2)}</span>
          <span className="ws-overview-row-text"><strong dir="auto">{account.channel === 'facebook' ? account.accountName : account.handle || account.accountName}</strong><small>{channels[account.channel]}</small></span>
          <span className={props.connectionsVerified ? 'ws-overview-success' : 'ws-overview-attention'} role="img" aria-label={t(props.connectionsVerified ? 'Terhubung' : 'Status tersimpan, belum diperbarui')}>{props.connectionsVerified ? <Check size={17}/> : <CircleHelp size={17}/>}</span>
        </li>)}</ul> : <p className="ws-overview-social-empty">{t(props.connectionsVerified ? 'Belum ada akun terhubung.' : 'Status akun sosial belum dapat diperiksa.')}</p>}
        <div className="ws-overview-card-actions"><button type="button" className="ws-overview-text-button" onClick={props.onConnections}>{t('Kelola akun sosial')}{connected.length > 4 && <> ({number.format(connected.length)})</>}<ArrowRight size={15} aria-hidden="true" className="ws-overview-arrow"/></button></div>
        <div className="ws-overview-profile-row"><div><strong>{t('Profil bisnis')}</strong><p dir="auto">{props.brand.businessName}</p></div><button type="button" onClick={props.onEditProfile} className="ws-overview-text-button">{t('Perbarui profil')} <ArrowRight size={15} aria-hidden="true" className="ws-overview-arrow"/></button></div>
      </section>
    </div>
  </div>;
}
