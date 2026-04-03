/**
 * useUploadFile — uploads files to Blossom servers.
 *
 * Automatically uses the user's BUD-03 kind:10063 server list.
 * Falls back to blossom.primal.net if no list is found.
 */
import { useMutation } from "@tanstack/react-query";
import { BlossomUploader } from '@nostrify/nostrify/uploaders';
import { useCurrentUser } from "./useCurrentUser";
import { useBlossomServers } from "./useBlossomServers";

export function useUploadFile() {
  const { user } = useCurrentUser();
  // BUD-03: get the user's preferred Blossom servers
  const { data: blossomServers } = useBlossomServers();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      // Use the user's BUD-03 servers, or fall back to primal
      const servers = blossomServers && blossomServers.length > 0
        ? blossomServers.map(s => s.endsWith('/') ? s : s + '/')
        : ['https://blossom.primal.net/'];

      const uploader = new BlossomUploader({
        servers,
        signer: user.signer,
      });

      const tags = await uploader.upload(file);
      return tags;
    },
  });
}
