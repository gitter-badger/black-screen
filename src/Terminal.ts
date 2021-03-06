import fs = require('fs');
import _ = require('lodash');
import i = require('./Interfaces');
import events = require('events');
import Invocation = require('./Invocation');
import Aliases = require('./Aliases');
import History = require('./History');
import Utils = require('./Utils');
var remote = require('remote');
var app = remote.require('app');

class Terminal extends events.EventEmitter {
    invocations: Array<Invocation>;
    currentDirectory: string;
    history: History;
    gitBranchWatcher: fs.FSWatcher;

    private stateFileName = `${process.env.HOME}/.black-screen-state`;
    private serializableProperties: _.Dictionary<string> = {currentDirectory: process.env.HOME};

    constructor(private dimensions: i.Dimensions) {
        super();

        this.restore();
        this.history = new History();

        this.observeSerializableProperties(() => {
            this.serialize();
        });

        Aliases.initialize();

        this.clearInvocations();
    }

    createInvocation(): void {
        var invocation = new Invocation(this.currentDirectory, this.dimensions, this.history);
        invocation.once('end', () => {
            if (app.dock) {
                app.dock.bounce('informational');
            }
            this.createInvocation();
        }).once('working-directory-changed', (newWorkingDirectory: string) => {
            this.setCurrentDirectory(newWorkingDirectory);
        });
        this.invocations = this.invocations.concat(invocation);
        this.emit('invocation');
    }

    resize(dimensions: i.Dimensions): void {
        this.dimensions = dimensions;

        this.invocations.forEach((invocation) => {
            invocation.resize(dimensions);
        });
    }

    clearInvocations(): void {
        this.invocations = [];
        this.createInvocation();
    }

    setCurrentDirectory(value: string): void {
        remote.getCurrentWindow().setRepresentedFilename(value);
        this.currentDirectory = value;
        app.addRecentDocument(value);
        this.watchGitBranch(value);
    }

    private watchGitBranch(directory: string): void {
        if (this.gitBranchWatcher) {
            this.gitBranchWatcher.close();
        }
        var gitDirectory = `${directory}/.git`;

        Utils.ifExists(gitDirectory, () => {
            this.setGitBranch(gitDirectory);
            this.gitBranchWatcher = fs.watch(gitDirectory, (type, fileName) => {
                if (fileName == 'HEAD') {
                    this.setGitBranch(gitDirectory);
                }
            })
        }, () => {
            this.emit('vcs-data', {isRepository: false});
        });
    }

    private setGitBranch(gitDirectory: string) {
        fs.readFile(`${gitDirectory}/HEAD`, (error, buffer) => {
            var data: i.VcsData = {
                isRepository: true,
                branch: /ref: refs\/heads\/(.*)/.exec(buffer.toString())[1],
                // TODO: Set proper status.
                status: 'clean'
            };
            this.emit('vcs-data', data);
        });
    }

    private observeSerializableProperties(callback: Function): void {
        (<any>Object).observe(this, (changes: Array<ObjectChange>) => {
            if (this.serializablePropertiesHasChanged(changes)) {
                callback();
            }
        });
    }

    private serializablePropertiesHasChanged(changes: Array<ObjectChange>): boolean {
        var names = _.map(changes, _.property('name'));
        return !_.isEmpty(_.intersection(_.keys(this.serializableProperties), names));
    }

    private serialize(): void {
        var values: _.Dictionary<string> = {};

        _.each(this.serializableProperties, (value: string, key: string) => {
            values[key] = (<any>this)[key];
        });

        fs.writeFile(this.stateFileName, JSON.stringify(values), (error: any) => {
            if (error) debugger;
        })
    }

    private restore(): void {
        try {
            var state = JSON.parse(fs.readFileSync(this.stateFileName).toString());
        } catch
            (error) {
            state = this.serializableProperties;
        }

        _.each(state, (value: string, key: string) => {
            var setterName = `set${_.capitalize(key)}`;
            var that = (<any>this);

            if (that[setterName]) {
                that[setterName](value);
            } else {
                that[key] = value;
            }
        });
    }
}

export = Terminal;
