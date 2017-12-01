declare module "nativescript-couchbase" {

    export enum ReplicationStatus {
        Stopped = 0,
        Offline,
        Idle,
        Active,
    }

    export class Couchbase {
        constructor(databaseName: string);
        createDocument(data: Object, documentId?: string);
        getDocument(documentId: string);
        updateDocument(documentId: string, data: any);
        deleteDocument(documentId: string): boolean;
        destroyDatabase();
        createView(viewName: string, viewRevision: string, callback: any);
        executeQuery(viewName: string, options?: any);
        createPullReplication(remoteUrl: string): Replicator;
        createPushReplication(remoteUrl: string): Replicator;
        addDatabaseChangeListener(callback: (changes: DatabaseChange[]) => void);
        removeDatabaseChangeListener(listener: any);
        addDatabaseConflictsListener(
            conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[],
            successCallback: (documentId: string) => void,
            errorCallback: (documentId: string, error: any) => void): any;
        removeDatabaseConflictsListener(listener: any);
    }

    export class Replicator {
        constructor(replicator: any);
        start();
        stop();
        isRunning();
        setContinuous(isContinuous: boolean);
        setCookie(name: String, value: String, path: String, expirationDate: Date, secure: boolean);
        deleteCookie(name: String);
        setAuthenticator(authenticator: any);
        addReplicationChangeListener(callback: (replicationStatus: ReplicationStatus) => void): any;
        removeReplicationChangeListener(listener: any);
        getLastError(): any;
        getStatus(): any;
    }

    export class Authenticator {
        static createBasicAuthenticator(username: string, password: string);
    }

    export class DatabaseChange {
        constructor(change: any);
        getDocumentId(): string;
        getRevisionId(): string;
        getSourceURL(): string;
        isCurrentRevision(): boolean;
        isConflict(): boolean;
        isDeletion(): boolean;
    }

    export abstract class Revision {
        getId(): string;
        getUserProperties(): any;
        getIsDeletion(): boolean;
    }

    export class SavedRevision extends Revision {
        createRevision(): UnsavedRevision;
    }

    export class UnsavedRevision extends Revision {
        setIsDeletion(value: boolean): void;
        saveAllowingConflict(): void;
    }

}
