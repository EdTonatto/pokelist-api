-- Initial PokeList schema
CREATE TYPE "SpaceRole" AS ENUM ('OWNER','EDITOR','VIEWER');
CREATE TYPE "WishlistType" AS ENUM ('COLLECTION','POKEMON','CUSTOM');
CREATE TYPE "ItemStatus" AS ENUM ('WANTED','ACQUIRED');
CREATE TABLE "User" (
 "id" UUID NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
 "displayName" TEXT NOT NULL, "emailVerifiedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "Space" (
 "id" UUID NOT NULL, "name" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SpaceMember" (
 "spaceId" UUID NOT NULL, "userId" UUID NOT NULL, "role" "SpaceRole" NOT NULL,
 CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("spaceId","userId")
);
CREATE TABLE "Wishlist" (
 "id" UUID NOT NULL, "spaceId" UUID NOT NULL, "name" TEXT NOT NULL,
 "description" TEXT, "type" "WishlistType" NOT NULL DEFAULT 'CUSTOM',
 "setId" TEXT, "pokemonName" TEXT, "createdBy" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Wishlist_spaceId_idx" ON "Wishlist"("spaceId");
CREATE TABLE "WishlistItem" (
 "id" UUID NOT NULL, "wishlistId" UUID NOT NULL,
 "provider" TEXT NOT NULL DEFAULT 'tcgdex', "providerCardId" TEXT NOT NULL,
 "cardName" TEXT NOT NULL, "localId" TEXT NOT NULL, "setId" TEXT NOT NULL,
 "setName" TEXT NOT NULL, "setOfficialTotal" INTEGER, "imageUrl" TEXT,
 "language" TEXT NOT NULL DEFAULT 'pt-br', "status" "ItemStatus" NOT NULL DEFAULT 'WANTED',
 "notes" TEXT, "addedBy" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acquiredAt" TIMESTAMP(3),
 CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WishlistItem_wishlistId_provider_providerCardId_key" ON "WishlistItem"("wishlistId","provider","providerCardId");
CREATE INDEX "WishlistItem_wishlistId_status_idx" ON "WishlistItem"("wishlistId","status");
CREATE TABLE "Session" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE TABLE "OneTimeToken" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" TEXT NOT NULL,
 "purpose" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OneTimeToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OneTimeToken_tokenHash_key" ON "OneTimeToken"("tokenHash");
CREATE INDEX "OneTimeToken_userId_purpose_idx" ON "OneTimeToken"("userId","purpose");
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "Wishlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OneTimeToken" ADD CONSTRAINT "OneTimeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
