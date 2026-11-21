import { useCallback, useEffect, useState } from 'react';
import * as masterApi from '../services/masterResume.service';

/**
 * Loads the signed-in user's master resume and exposes upload/replace/delete.
 * upload state: null | { file, phase: 'uploading'|'processing', percent }
 */
export function useMasterResume() {
  const [state, setState] = useState({ status: 'loading', resume: null, error: null });
  const [upload, setUpload] = useState(null);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const resume = await masterApi.fetchMasterResume();
      setState({ status: 'ready', resume, error: null });
    } catch (error) {
      setState({ status: 'error', resume: null, error });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const uploadFile = useCallback(async (file, mode) => {
    setUpload({ file, phase: 'uploading', percent: 0 });
    try {
      const resume = await masterApi.uploadMasterResume(file, {
        mode,
        onProgress: (percent) =>
          setUpload((u) => (u ? { ...u, percent: percent ?? u.percent, phase: percent === 100 ? 'processing' : 'uploading' } : u)),
      });
      setState({ status: 'ready', resume, error: null });
      return resume;
    } finally {
      setUpload(null);
    }
  }, []);

  const remove = useCallback(async () => {
    await masterApi.deleteMasterResume();
    setState({ status: 'ready', resume: null, error: null });
  }, []);

  return { ...state, upload, reload, uploadFile, remove };
}
