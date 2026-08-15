import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { assertSameCampus } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import type { CategoryCreateInput, CategoryUpdateInput } from "@/validations/product";

/**
 * Product categories (PRD §20).
 *
 * Categories belong to a campus and are curated by its Campus Admin: vendors
 * choose from the list but cannot extend it, so one store cannot pollute the
 * campus taxonomy. Every read is campus-scoped in the query (Rule 25).
 */

export type CategorySummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Live products currently visible in the marketplace for this category. */
  productCount?: number;
};

function requireAdmin(actor: Actor): void {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only a campus admin can manage categories");
  }
}

/**
 * Resolves the campus an action applies to: the actor's own, except for a Super
 * Admin, who must name one explicitly.
 */
function targetCampus(actor: Actor, requestedCampusId?: string): string {

  const campusId = actor.role === "SUPER_ADMIN" ? requestedCampusId : actor.campusId;
  if (!campusId) throw new ValidationError("A campus must be specified");
  assertSameCampus(actor, campusId);
  return campusId;
}

/**
 * Categories on the actor's campus.
 *
 * Inactive categories are only returned to an admin: a student filtering the
 * marketplace should not see a taxonomy the campus has retired.
 */
export async function listCategories(
  actor: Actor,
  options?: { campusId?: string; includeInactive?: boolean },
): Promise<CategorySummary[]> {
  const campusId = targetCampus(actor, options?.campusId);


  const includeInactive =
    (actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN") &&
    options?.includeInactive === true;

  const categories = await prisma.category.findMany({
    where: { campusId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      sortOrder: true,
      isActive: true,
    },
  });

  return categories;
}


export async function createCategory(
  actor: Actor,
  input: CategoryCreateInput,
  options?: { campusId?: string },
): Promise<CategorySummary> {
  requireAdmin(actor);
  const campusId = targetCampus(actor, options?.campusId);

  const slug = slugify(input.name);
  if (slug.length < 2) throw new ValidationError("Category name must contain letters or numbers");

  const clash = await prisma.category.findFirst({
    where: { campusId, slug },
    select: { id: true },
  });
  if (clash) throw new ConflictError("This campus already has a category with that name");

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.create({
      data: {
        campusId,
        name: input.name,
        slug,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        sortOrder: true,
        isActive: true,
      },
    });

    await recordAudit(
      {
        action: AuditAction.CATEGORY_CREATED,
        entityType: "Category",
        entityId: category.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        after: { name: category.name, slug: category.slug },
      },
      tx,
    );

    return category;
  });
}

/**
 * Renames, reorders, or activates/deactivates a category.
 *
 * Deactivation is used instead of deletion: products already pointing at the
 * category keep their reference, and past orders stay explainable.
 */
export async function updateCategory(
  actor: Actor,
  categoryId: string,
  input: CategoryUpdateInput,
): Promise<CategorySummary> {
  requireAdmin(actor);

  const existing = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      campusId: true,
      name: true,
      slug: true,
      description: true,
      sortOrder: true,
      isActive: true,
    },
  });
  if (!existing) throw new NotFoundError("Category not found");
  assertSameCampus(actor, existing.campusId);

  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  if (input.name !== undefined) {
    const slug = slugify(input.name);
    if (slug.length < 2) throw new ValidationError("Category name must contain letters or numbers");

    const clash = await prisma.category.findFirst({
      where: { campusId: existing.campusId, slug, id: { not: existing.id } },
      select: { id: true },
    });
    if (clash) throw new ConflictError("This campus already has a category with that name");

    data.name = input.name;
    data.slug = slug;
  }

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        sortOrder: true,
        isActive: true,
      },
    });

    await recordAudit(
      {
        action: AuditAction.CATEGORY_UPDATED,
        entityType: "Category",
        entityId: category.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: {
          name: existing.name,
          sortOrder: existing.sortOrder,
          isActive: existing.isActive,
        },
        after: data,
      },
      tx,
    );

    return category;
  });
}

/**
 * Validates that a category belongs to the given campus.
 *
 * Used by the product service so a vendor cannot attach their product to
 * another campus's category by guessing its id.
 */
export async function assertCategoryOnCampus(
  categoryId: string,
  campusId: string,
): Promise<void> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, campusId },
    select: { id: true, isActive: true },
  });
  if (!category) throw new ValidationError("Choose a category from your campus");
  if (!category.isActive) throw new ValidationError("That category is no longer available");
}
