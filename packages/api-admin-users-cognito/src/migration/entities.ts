import { Entity, Table } from "dynamodb-toolbox";

const createEntity = (entityName: string, table: Table, attributes: any = {}): Entity<any> => {
    return new Entity({
        table,
        name: entityName,
        attributes: {
            PK: {
                partitionKey: true
            },
            SK: {
                sortKey: true
            },
            GSI1_PK: {
                type: "string"
            },
            GSI1_SK: {
                type: "string"
            },
            TYPE: {
                type: "string"
            },
            ...attributes
        }
    });
};

export const createUserEntity = table => {
    return createEntity("SecurityUser", table, {
        id: {
            type: "string"
        },
        login: {
            type: "string"
        },
        firstName: {
            type: "string"
        },
        lastName: {
            type: "string"
        },
        avatar: {
            type: "map"
        },
        createdBy: {
            type: "map"
        },
        createdOn: {
            type: "string"
        }
    });
};

export const createLinkEntity = table => {
    return createEntity("SecurityUser2Tenant", table, {
        id: {
            type: "string"
        },
        tenant: {
            type: "map"
        },
        group: {
            type: "map"
        }
    });
};

export const createGroupEntity = table => {
    return createEntity("SecurityGroup", table, {
        id: {
            type: "string"
        },
        tenant: {
            type: "string"
        },
        system: {
            type: "boolean"
        },
        createdBy: {
            type: "map"
        },
        createdOn: {
            type: "string"
        },
        name: {
            type: "string"
        },
        slug: {
            type: "string"
        },
        description: {
            type: "string"
        },
        permissions: {
            type: "list"
        }
    });
};

export const createApiKeyEntity = table => {
    return createEntity("SecurityApiKey", table, {
        id: {
            type: "string"
        },
        token: {
            type: "string"
        },
        tenant: {
            type: "string"
        },
        createdBy: {
            type: "map"
        },
        createdOn: {
            type: "string"
        },
        name: {
            type: "string"
        },
        description: {
            type: "string"
        },
        permissions: {
            type: "list"
        }
    });
};
