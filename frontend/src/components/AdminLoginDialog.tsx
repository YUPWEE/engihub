import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errorKey, useAdmin } from "@/lib/queries";
import type { AdminLogin, AdminMe } from "@/lib/types";

function LoginForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const m = useMutation({
    mutationFn: (body: AdminLogin) => apiPost<AdminMe>("/admin/login", body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-me"] });
      toast.success(t("adminWelcome"));
      onDone();
      navigate("/admin");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) m.mutate({ password });
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="admin-login-form">
      <div className="space-y-1.5">
        <Label htmlFor="admin-password">{t("password")}</Label>
        <Input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          data-testid="admin-password-input"
        />
      </div>
      {m.isError && (
        <p className="text-sm text-destructive" role="alert" data-testid="admin-login-error">
          {t(errorKey(m.error))}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={m.isPending || !password} data-testid="admin-login-submit">
        {t("enter")}
      </Button>
    </form>
  );
}

export function AdminLoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const isAdmin = useAdmin();
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="admin-login-dialog">
        <DialogHeader className="pe-8">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-sage" />
            {t("adminLoginTitle")}
          </DialogTitle>
          <DialogDescription>{isAdmin ? t("adminOn") : t("adminLoginSub")}</DialogDescription>
        </DialogHeader>
        {isAdmin ? (
          <Button
            onClick={() => {
              onOpenChange(false);
              navigate("/admin");
            }}
            data-testid="admin-goto-dashboard-button"
          >
            {t("dashboard")}
          </Button>
        ) : (
          <LoginForm onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
