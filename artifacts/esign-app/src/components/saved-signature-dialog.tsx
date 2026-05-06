import { useState } from "react";
import { PenLine } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSaveSignature,
  useGetSavedSignature,
  getGetSavedSignatureQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SignaturePad } from "@/components/signature-pad";
import { useToast } from "@/hooks/use-toast";

interface SavedSignatureDialogProps {
  children: React.ReactNode;
}

export function SavedSignatureDialog({ children }: SavedSignatureDialogProps) {
  const [open, setOpen] = useState(false);
  const [newSig, setNewSig] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useGetSavedSignature({ query: { enabled: open, queryKey: getGetSavedSignatureQueryKey() } });
  const saveMutation = useSaveSignature();

  const handleSave = () => {
    if (!newSig) {
      toast({ variant: "destructive", title: "Please draw your signature first" });
      return;
    }
    saveMutation.mutate(
      { data: { signatureData: newSig } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: "Signature saved successfully" });
          setNewSig("");
          setOpen(false);
        },
        onError: () => {
          toast({ variant: "destructive", title: "Failed to save signature" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNewSig(""); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5" />
            My Saved Signature
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {data?.signatureData && (
            <div>
              <p className="text-sm font-medium mb-2">Current signature:</p>
              <div className="border rounded-lg p-3 bg-muted/30 flex items-center justify-center min-h-[80px]">
                <img
                  src={data.signatureData}
                  alt="Saved signature"
                  className="max-h-16 object-contain"
                />
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium mb-2">
              {data?.signatureData ? "Draw a new signature:" : "Draw your signature below:"}
            </p>
            <SignaturePad
              onSign={(sig) => setNewSig(sig)}
              onClear={() => setNewSig("")}
            />
            <p className="text-xs text-muted-foreground mt-2">
              This signature can be used to quickly sign documents in the future.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!newSig || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save Signature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
