import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { errorKey } from "@/lib/queries";

export interface FieldDef {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "select" | "checkbox" | "number";
  options?: { value: string; label: string }[];
  ltr?: boolean;
}
export type FieldValues = Record<string, string | boolean>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  fields: FieldDef[];
  initial: FieldValues;
  onSave: (v: FieldValues) => Promise<unknown>;
  testid: string;
}

function EditForm({ fields, initial, onSave, onDone, testid }: Omit<Props, "open" | "onOpenChange" | "title"> & { onDone: () => void }) {
  const { t } = useI18n();
  const [values, setValues] = useState<FieldValues>(initial);
  const set = (k: string, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));
  const m = useMutation({
    mutationFn: onSave,
    onSuccess: () => {
      toast.success(t("saved"));
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate(values);
  };
  return (
    <form onSubmit={submit} className="space-y-3.5" data-testid={`${testid}-form`}>
      {fields.map((f) => {
        const id = `${testid}-${f.name}`;
        const v = values[f.name];
        if (f.kind === "checkbox")
          return (
            <label key={f.name} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!v} onCheckedChange={(c) => set(f.name, !!c)} data-testid={id} />
              {f.label}
            </label>
          );
        return (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={id}>{f.label}</Label>
            {f.kind === "textarea" ? (
              <Textarea id={id} value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} data-testid={id} />
            ) : f.kind === "select" ? (
              <Select value={String(v ?? "")} onValueChange={(val: string) => set(f.name, val)}>
                <SelectTrigger className="w-full" data-testid={id}>
                  <SelectValue>{(val) => f.options?.find((o) => o.value === val)?.label ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {f.options?.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                type={f.kind === "number" ? "number" : "text"}
                dir={f.ltr ? "ltr" : undefined}
                value={String(v ?? "")}
                onChange={(e) => set(f.name, e.target.value)}
                data-testid={id}
              />
            )}
          </div>
        );
      })}
      {m.isError && (
        <p className="text-sm text-destructive" role="alert" data-testid={`${testid}-error`}>
          {t(errorKey(m.error))}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone} data-testid={`${testid}-cancel`}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={m.isPending} data-testid={`${testid}-save`}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

export function EditDialog({ open, onOpenChange, title, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid={rest.testid}>
        <DialogHeader className="pe-8">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <EditForm {...rest} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
