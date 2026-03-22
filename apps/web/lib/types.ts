export type Group = {
  id: string;
  name: string;
};

export type Photo = {
  id: string;
  groupId: string;
  uploaderId: string;
  status: "queued" | "processing" | "processed" | "failed";
  storageKey: string;
  createdAt: string;
};

export type Share = {
  id: string;
  photoId: string;
  recipientUserId: string;
  status: "active" | "hidden" | "deleted";
  createdAt: string;
};
