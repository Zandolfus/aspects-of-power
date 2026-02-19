const { fields } = foundry.data;

/**
 * Data model for feature-type items (class features, abilities).
 */
export class FeatureData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
    };
  }
}
