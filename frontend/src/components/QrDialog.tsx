import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

export function QrDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const url = typeof window !== "undefined" ? window.location.origin : "";

  const download = () => {
    const canvas = wrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "engihub-qr.png";
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="qr-dialog">
        <DialogHeader className="pe-8">
          <DialogTitle>{t("qrTitle")}</DialogTitle>
          <DialogDescription>{t("qrDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div ref={wrap} className="rounded-2xl bg-white p-4" data-testid="qr-code-canvas">
            <QRCodeCanvas value={url} size={220} marginSize={1} level="M" />
          </div>
          <p dir="ltr" className="max-w-full truncate text-xs text-muted-foreground" data-testid="qr-url">
            {url}
          </p>
          <Button onClick={download} className="w-full" data-testid="qr-download-button">
            <Download className="size-4" />
            {t("downloadPng")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
