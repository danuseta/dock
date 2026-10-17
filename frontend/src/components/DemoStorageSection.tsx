import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { HardDrive, Trash2 } from 'lucide-react';
import { GET_DEMO_STORAGE } from '../graphql/queries';
import { CLEAR_DEMO_STORAGE, SAVE_DEMO_STORAGE } from '../graphql/mutations';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { demoLinkExample, type DemoStorageView } from '../lib/demoVideos';
import { Badge, Button, Card, Input } from './ui';

const FIELDS = [
  { name: 'endpoint', label: 'S3 endpoint', placeholder: 'https://s3.example.com' },
  { name: 'region', label: 'Region', placeholder: 'us-east-1' },
  { name: 'bucket', label: 'Bucket', placeholder: 'my-bucket' },
  { name: 'folder', label: 'Folder', placeholder: 'demo-qonflo' },
  { name: 'publicBaseUrl', label: 'Public base URL', placeholder: 'https://www.example.com/assets' },
] as const;

type FieldName = typeof FIELDS[number]['name'];

export const DemoStorageSection: React.FC = () => {
  const { data, error, refetch } = useQuery(GET_DEMO_STORAGE, CACHED_QUERY_OPTIONS);
  const [saveStorage, { loading: saving }] = useMutation(SAVE_DEMO_STORAGE);
  const [clearStorage, { loading: clearing }] = useMutation(CLEAR_DEMO_STORAGE);
  const storage: DemoStorageView | undefined = data?.demoStorage;
  const [form, setForm] = useState<Record<FieldName, string>>({ endpoint: '', region: '', bucket: '', folder: '', publicBaseUrl: '' });
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (storage) setForm({ endpoint: storage.endpoint, region: storage.region, bucket: storage.bucket, folder: storage.folder, publicBaseUrl: storage.publicBaseUrl });
  }, [storage]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    try {
      await saveStorage({ variables: { input: { ...form, accessKey, secretKey } } });
      setAccessKey('');
      setSecretKey('');
      await refetch();
      setNotice({ text: 'Saved for both DOCKs.', error: false });
    } catch (saveError: any) {
      setNotice({ text: saveError.message || 'Failed to save', error: true });
    }
  };

  const handleClear = async () => {
    setNotice(null);
    try {
      await clearStorage();
      await refetch();
      setNotice({ text: 'Removed. Demo uploads stop until it is set again.', error: false });
    } catch (clearError: any) {
      setNotice({ text: clearError.message || 'Failed to remove', error: true });
    }
  };

  return (
    <Card>
      <h3 className="mb-4 flex items-center gap-2 border-b border-border pb-2 font-display text-lg font-bold"><HardDrive size={20} aria-hidden="true" />Demo video storage{storage?.configured && <Badge variant="success">SET</Badge>}</h3>
      <p className="mb-4 text-pretty text-sm text-secondary-foreground">The S3 bucket the demo videos go to, one setting for both DOCKs. The laptop DOCK keeps it; the keys are stored encrypted and never shown again. Each video gets the link {demoLinkExample(storage)}.</p>
      {error && !data && <p className="mb-3 text-sm text-status-conflict" role="alert">Storage settings failed to load: {error.message}</p>}

      <form className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1" onSubmit={handleSave}>
        {FIELDS.map((field) => (
          <label key={field.name}><span className="mb-1 block text-sm font-medium">{field.label}</span><Input value={form[field.name]} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} placeholder={field.placeholder} required /></label>
        ))}
        <label><span className="mb-1 block text-sm font-medium">Access key</span><Input type="password" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={storage?.accessKeyMasked || 'Access key ID'} required={!storage?.accessKeyMasked} /><span className="mt-1 block text-xs text-muted-foreground">{storage?.accessKeyMasked ? 'Leave empty to keep the saved one.' : 'Not set yet.'}</span></label>
        <label><span className="mb-1 block text-sm font-medium">Secret key</span><Input type="password" autoComplete="off" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={storage?.secretSet ? '••••••••' : 'Secret access key'} required={!storage?.secretSet} /><span className="mt-1 block text-xs text-muted-foreground">{storage?.secretSet ? 'Leave empty to keep the saved one.' : 'Not set yet.'}</span></label>
        <div className="col-span-full flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : 'Save storage'}</Button>
          {storage?.configured && <Button type="button" className="text-status-conflict" disabled={clearing} onClick={() => void handleClear()}><Trash2 size={15} aria-hidden="true" />Remove</Button>}
        </div>
      </form>
      {notice && <p className={notice.error ? 'mt-3 text-pretty text-sm text-status-conflict' : 'mt-3 text-pretty text-sm text-status-merged'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    </Card>
  );
};
