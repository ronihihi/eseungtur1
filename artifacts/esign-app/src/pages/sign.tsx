import { useState } from "react";
import { useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileSignature, CheckCircle2, AlertCircle } from "lucide-react";

import { useGetSigningInfo, getGetSigningInfoQueryKey, useSubmitSignature } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { SignaturePad } from "@/components/signature-pad";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const signatureSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  signatureData: z.string().min(1, "Signature is required"),
});

export function SignPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState(false);

  const { data, isLoading, isError, error } = useGetSigningInfo(token, {
    query: {
      enabled: !!token,
      queryKey: getGetSigningInfoQueryKey(token),
      retry: false,
    }
  });

  const submitSignatureMutation = useSubmitSignature();

  const form = useForm<z.infer<typeof signatureSchema>>({
    resolver: zodResolver(signatureSchema),
    defaultValues: {
      fullName: "",
      signatureData: "",
    },
  });

  // Watch signature data to clear error when user signs
  const signatureData = form.watch("signatureData");

  const onSubmit = (values: z.infer<typeof signatureSchema>) => {
    submitSignatureMutation.mutate(
      { token, data: values },
      {
        onSuccess: () => {
          setSuccess(true);
          queryClient.invalidateQueries({ queryKey: getGetSigningInfoQueryKey(token) });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Submission failed", description: err.error });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Skeleton className="h-8 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 p-4">
        <Alert variant="destructive" className="w-full max-w-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Invalid or Expired Link</AlertTitle>
          <AlertDescription>
            {(error as any)?.error || "The signature link you provided is invalid or has expired."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (data.alreadySigned || success) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-lg text-center border-green-500/20 shadow-green-500/5">
          <CardContent className="pt-12 pb-12 flex flex-col items-center">
            <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">Thank you!</h2>
            <p className="text-muted-foreground">
              Your signature has been securely recorded for "{data.documentTitle}".
            </p>
            <p className="text-sm text-muted-foreground mt-6">
              You can now close this window.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/30">
      <header className="bg-card border-b py-4">
        <div className="container mx-auto px-4 flex items-center gap-2 font-semibold text-primary">
          <FileSignature className="h-5 w-5" />
          <span>WorkflowSign</span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center p-4 py-12">
        <Card className="w-full max-w-xl shadow-lg border-border/50">
          <CardHeader className="text-center pb-8 border-b bg-card rounded-t-xl">
            <div className="mx-auto bg-primary/10 w-16 h-16 flex items-center justify-center rounded-2xl mb-4 text-primary">
              <FileSignature className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl font-bold">{data.documentTitle}</CardTitle>
            <CardDescription className="text-base mt-2">
              Signature requested for {data.recipient.teamName}
            </CardDescription>
          </CardHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent className="space-y-8 pt-8">
                
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Confirm your identity</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your full legal name" className="text-lg py-6" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="signatureData"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Draw your signature</FormLabel>
                      <FormControl>
                        <div className={`rounded-lg transition-colors ${form.formState.errors.signatureData ? 'ring-2 ring-destructive ring-offset-2' : ''}`}>
                          <SignaturePad 
                            onSign={(data) => {
                              field.onChange(data);
                              form.clearErrors("signatureData");
                            }}
                            onClear={() => field.onChange("")}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="bg-muted p-4 rounded-lg text-sm text-muted-foreground flex gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                  <p>
                    By signing this document, you agree that your electronic signature is the legally binding equivalent to your handwritten signature.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="border-t bg-muted/20 p-6 rounded-b-xl">
                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full text-lg" 
                  disabled={submitSignatureMutation.isPending || !signatureData}
                >
                  {submitSignatureMutation.isPending ? "Submitting..." : "Submit Document"}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      </main>
    </div>
  );
}
