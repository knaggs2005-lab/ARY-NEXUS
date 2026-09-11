export function isCurrentRelationship(
  edge: import("../domain/models").Relationship,
) {
  return (
    (!edge.valid_from || Date.parse(edge.valid_from) <= Date.now()) &&
    (!edge.valid_to || Date.parse(edge.valid_to) > Date.now())
  );
}
