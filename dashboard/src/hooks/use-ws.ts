import { useState, useEffect, useCallback } from 'react';
import { wsClient, type FileMessage } from '@/lib/ws';

export function useWs() {
  const [status, setStatus] = useState(wsClient.status);
  const [messages, setMessages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileMessage[]>([]);

  useEffect(() => {
    wsClient.connect();
    const unsubStatus = wsClient.onStatus(setStatus);
    const unsubMsg = wsClient.subscribe((data) => {
      setMessages((prev) => [...prev, data]);
    });
    const unsubFile = wsClient.subscribeFile((file) => {
      setFiles((prev) => [...prev, file]);
    });
    return () => {
      unsubStatus();
      unsubMsg();
      unsubFile();
    };
  }, []);

  const send = useCallback((text: string) => {
    wsClient.send(text);
  }, []);

  return { status, messages, files, send };
}
