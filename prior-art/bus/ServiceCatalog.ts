import type { ServiceSpecification } from "./ServiceTypes.js";
import { serviceSpec as serviceHostSpec } from "../services/ServiceHostService.def.js";
import { serviceSpec as stateManagerSpec } from "../services/StateManagerService.def.js";
import { serviceSpec as avatarSpec } from "../services/AvatarService.def.js";
import { serviceSpec as chatSpec } from "../services/ChatService.def.js";
import { serviceSpec as knowledgeSpec } from "../services/KnowledgeService.def.js";
import { serviceSpec as contentSpec } from "../services/ContentService.def.js";

/**
 * Explicit service registry. Add new service specs here.
 */
export const serviceCatalog: Record<string, ServiceSpecification> = {
  [serviceHostSpec.name]: serviceHostSpec,
  [stateManagerSpec.name]: stateManagerSpec,
  [avatarSpec.name]: avatarSpec,
  [chatSpec.name]: chatSpec,
  [knowledgeSpec.name]: knowledgeSpec,
  [contentSpec.name]: contentSpec,
};
