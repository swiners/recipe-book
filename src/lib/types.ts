export type Ingredient = { item: string; qty: string; unit: string };

export type Recipe = {
  id: string;
  user_id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: string[];
  tags: string[];
  allium_free: boolean;
  source_url: string | null;
  notes: string | null;
  rating: number | null;
  last_cooked: string | null;
  /** Object path in the private recipe-photos bucket, "<user id>/<uuid>.jpg". */
  photo_path: string | null;
  created_at: string;
  updated_at: string;
};

/** A new recipe before the database fills in ownership and timestamps. */
export type RecipeDraft = Omit<Recipe, "id" | "user_id" | "created_at" | "updated_at">;

export const emptyDraft = (): RecipeDraft => ({
  title: "",
  servings: null,
  prep_minutes: null,
  cook_minutes: null,
  ingredients: [{ item: "", qty: "", unit: "" }],
  steps: [""],
  tags: [],
  allium_free: false,
  source_url: null,
  notes: null,
  rating: null,
  last_cooked: null,
  photo_path: null,
});
