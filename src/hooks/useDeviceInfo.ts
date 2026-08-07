import { useEffect, useState } from 'react';

interface DeviceInfo {
  deviceHash: string | null;
}

interface DeviceBridge {
  getInfo(): Promise<DeviceInfo>;
}

function getBridge(): DeviceBridge | null {
  const w = window as unknown as { evanDesktop?: { device?: DeviceBridge } };
  return w?.evanDesktop?.device ?? null;
}

/** 设备指纹，仅用于设置页展示（掩码显示）。无桥（web 预览）时保持 null。 */
export function useDeviceInfo() {
  const [deviceHash, setDeviceHash] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let active = true;
    bridge
      .getInfo()
      .then((info) => active && setDeviceHash(info.deviceHash))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return { deviceHash };
}
