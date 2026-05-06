import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { ArrowLeft, Send, Plus, Trash2, Mail, CheckCircle2, Clock, BellRing, Copy, Check } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

import { 
  useGetDocument, 
  getGetDocumentQueryKey, 
  useSetRecipients, 
  useSendDocument,
  useRemindRecipient,
  useGetDocumentStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const recipientsSchema = z.object({
  recipients: z.array(
    z.object({
      teamName: z.string().min(1, "Name is required"),
      email: z.string().email("Valid email required"),
    })
  ).min(1, "At least one recipient is required").max(7, "Maximum 7 recipients allowed"),
});

const sendSchema = z.object({
  subject: z.string().optional(),
  message: z.string().optional(),
});

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Real-time polling when document is sent
  const { data: detailData, isLoading } = useGetDocument(id, {
    query: {
      enabled: !!id,
      queryKey: getGetDocumentQueryKey(id),
    }
  });

  const doc = detailData?.document;
  const isDraft = doc?.status === "draft";
  const isSent = doc?.status === "sent";

  // Polling hook (only active if sent)
  useGetDocumentStatus(id, {
    query: {
      enabled: isSent,
      refetchInterval: 5000,
    }
  });

  const setRecipientsMutation = useSetRecipients();
  const sendDocumentMutation = useSendDocument();
  const remindMutation = useRemindRecipient();

  const [sendDialogOpen, setSendDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof recipientsSchema>>({
    resolver: zodResolver(recipientsSchema),
    defaultValues: {
      recipients: [{ teamName: "", email: "" }],
    },
  });

  const sendForm = useForm<z.infer<typeof sendSchema>>({
    resolver: zodResolver(sendSchema),
    defaultValues: {
      subject: "",
      message: "",
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "recipients",
  });

  // Pre-fill form when data loads
  useEffect(() => {
    if (detailData?.recipients && detailData.recipients.length > 0 && isDraft) {
      form.reset({
        recipients: detailData.recipients.map(r => ({
          teamName: r.teamName,
          email: r.email,
        }))
      });
    }
  }, [detailData, isDraft, form]);

  useEffect(() => {
    if (doc?.title) {
      sendForm.reset({
        subject: `Signature Request: ${doc.title}`,
        message: `Please review and sign the document "${doc.title}".`
      });
    }
  }, [doc?.title, sendForm]);

  const onSaveRecipients = (values: z.infer<typeof recipientsSchema>) => {
    setRecipientsMutation.mutate(
      { id, data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
          toast({ title: "Recipients saved" });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Error saving recipients", description: err.error });
        }
      }
    );
  };

  const onSendDocument = (values: z.infer<typeof sendSchema>) => {
    sendDocumentMutation.mutate(
      { id, data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
          setSendDialogOpen(false);
          toast({ title: "Document sent successfully!" });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Failed to send", description: err.error });
        }
      }
    );
  };

  const handleRemind = (recipientId: string) => {
    remindMutation.mutate(
      { recipientId },
      {
        onSuccess: () => toast({ title: "Reminder sent" }),
        onError: (err) => toast({ variant: "destructive", title: "Failed to send reminder", description: err.error }),
      }
    );
  };

  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  
  const handleCopyLink = (token: string) => {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(token);
      toast({ title: "Link copied to clipboard" });
      setTimeout(() => setCopiedLink(null), 2000);
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold">Document not found</h2>
        <Link href="/">
          <Button variant="link" className="mt-4">Return to dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary mb-4 transition-colors">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Dashboard
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span>{doc.filename}</span>
              <span>•</span>
              <span>{format(new Date(doc.createdAt), "MMM d, yyyy h:mm a")}</span>
              <span>•</span>
              <span className="capitalize">{doc.signingOrder} order</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={doc.status} />
            
            {isDraft && (
              <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!detailData?.recipients?.length || setRecipientsMutation.isPending}>
                    <Send className="mr-2 h-4 w-4" />
                    Send for Signature
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send Document</DialogTitle>
                    <DialogDescription>
                      This will email the signature link to all configured recipients.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...sendForm}>
                    <form onSubmit={sendForm.handleSubmit(onSendDocument)} className="space-y-4 py-4">
                      <FormField
                        control={sendForm.control}
                        name="subject"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Subject</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={sendForm.control}
                        name="message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Message (Optional)</FormLabel>
                            <FormControl>
                              <Textarea rows={4} {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button variant="outline" type="button" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={sendDocumentMutation.isPending}>
                          {sendDocumentMutation.isPending ? "Sending..." : "Send Now"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_350px] gap-6 items-start">
        <div className="space-y-6">
          {/* Main content area */}
          <Card>
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
              <CardDescription>
                {isDraft 
                  ? "Configure who needs to sign this document." 
                  : "Track the signature status of each recipient."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isDraft ? (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSaveRecipients)} className="space-y-6">
                    <div className="space-y-4">
                      {fields.map((field, index) => (
                        <div key={field.id} className="flex gap-4 items-start bg-muted/30 p-4 rounded-lg border border-border/50">
                          {doc.signingOrder === "sequential" && (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                              {index + 1}
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                            <FormField
                              control={form.control}
                              name={`recipients.${index}.teamName`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Name / Role</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g., Client or Jane Doe" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`recipients.${index}.email`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Email</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="jane@example.com" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          {fields.length > 1 && (
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="mt-8 text-muted-foreground hover:text-destructive"
                              onClick={() => remove(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => append({ teamName: "", email: "" })}
                        disabled={fields.length >= 7}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Recipient {fields.length}/7
                      </Button>
                      
                      <Button type="submit" disabled={setRecipientsMutation.isPending}>
                        {setRecipientsMutation.isPending ? "Saving..." : "Save Recipients"}
                      </Button>
                    </div>
                  </form>
                </Form>
              ) : (
                <div className="space-y-4">
                  {detailData?.recipients.map((recipient, idx) => (
                    <div key={recipient.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border bg-card hover:bg-muted/10 transition-colors">
                      <div className="flex items-center gap-4">
                        {doc.signingOrder === "sequential" && (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground font-medium text-sm">
                            {idx + 1}
                          </div>
                        )}
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {recipient.teamName}
                            {recipient.status === "signed" && recipient.signerName && (
                              <span className="text-xs font-normal text-muted-foreground">(Signed by {recipient.signerName})</span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {recipient.email}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 sm:ml-auto">
                        <RecipientStatusBadge status={recipient.status} date={recipient.signedAt || recipient.viewedAt} />
                        
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="icon" 
                            title="Copy signing link"
                            onClick={() => handleCopyLink(recipient.token)}
                          >
                            {copiedLink === recipient.token ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                          
                          {recipient.status !== "signed" && (
                            <Button 
                              variant="secondary" 
                              size="sm"
                              className="hidden sm:flex"
                              onClick={() => handleRemind(recipient.id)}
                              disabled={remindMutation.isPending}
                            >
                              <BellRing className="mr-2 h-4 w-4" />
                              Remind
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{doc.signedCount} / {doc.totalRecipients} Signed</span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-500" 
                  style={{ width: `${doc.totalRecipients > 0 ? (doc.signedCount / doc.totalRecipients) * 100 : 0}%` }}
                />
              </div>
              <Separator />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uploaded by</span>
                  <span className="font-medium text-right">{doc.uploaderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium text-right">{format(new Date(doc.createdAt), "MMM d, yyyy")}</span>
                </div>
                {doc.completedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completed</span>
                    <span className="font-medium text-right">{format(new Date(doc.completedAt), "MMM d, yyyy")}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600 text-white border-transparent">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Completed
        </Badge>
      );
    case "sent":
      return (
        <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-transparent">
          <Send className="mr-1 h-3 w-3" />
          Out for Signature
        </Badge>
      );
    case "draft":
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <FileText className="mr-1 h-3 w-3" />
          Draft
        </Badge>
      );
  }
}

function RecipientStatusBadge({ status, date }: { status: string, date?: string | null }) {
  const formattedDate = date ? format(new Date(date), "MMM d, h:mm a") : "";
  
  switch (status) {
    case "signed":
      return (
        <div className="flex flex-col items-end">
          <Badge variant="default" className="bg-green-500/10 text-green-700 hover:bg-green-500/20 border-transparent">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Signed
          </Badge>
          {formattedDate && <span className="text-[10px] text-muted-foreground mt-1">{formattedDate}</span>}
        </div>
      );
    case "viewed":
      return (
        <div className="flex flex-col items-end">
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-transparent">
            <Clock className="mr-1 h-3 w-3" />
            Viewed
          </Badge>
          {formattedDate && <span className="text-[10px] text-muted-foreground mt-1">{formattedDate}</span>}
        </div>
      );
    case "pending":
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Clock className="mr-1 h-3 w-3" />
          Pending
        </Badge>
      );
  }
}
