/* jslint node: true */
'use strict';

const { Errors }    = require('./enig_error.js');

//  deps
const fs            = require('graceful-fs');
const iconv         = require('iconv-lite');
const moment        = require('moment');

module.exports = class FilesBBSFile {
    constructor() {
        this.entries = new Map();
    }

    get(fileName) {
        return this.entries.get(fileName);
    }

    getDescription(fileName) {
        const entry = this.get(fileName);
        if(entry) {
            return entry.desc;
        }
    }

    static createFromFile(path, cb) {
        fs.readFile(path, (err, descData) => {
            if(err) {
                return cb(err);
            }

            //  :TODO: encoding should be default to CP437, but allowed to change - ie for Amiga/etc.
            const lines = iconv.decode(descData, 'cp437').split(/\r?\n/g);
            const filesBbs = new FilesBBSFile();

            //
            //  Contrary to popular belief, there is not a FILES.BBS standard. Instead,
            //  many formats have been used over the years. We'll try to support as much
            //  as we can within reason.
            //
            //  Resources:
            //  - Great info from Mystic @ http://wiki.mysticbbs.com/doku.php?id=mutil_import_files.bbs
            //  - https://alt.bbs.synchronet.narkive.com/I6Vrxq6q/format-of-files-bbs
            //
            //  Example files:
            //  - https://github.com/NuSkooler/ansi-bbs/tree/master/ancient_formats/files_bbs
            //
            const detectDecoder = () => {
                //  helpers
                const regExpTestUpTo = (n, re) => {
                    return lines
                        .slice(0, n)
                        .some(l => re.test(l));
                };

                //
                //  Try to figure out which decoder to use
                //
                const decoders = [
                    {
                        //  I've been told this is what Syncrhonet uses
                        lineRegExp : /^([^ ]{1,12})\s{1,11}([0-3][0-9]\/[0-3][0-9]\/[1789][0-9]) ([^\r\n]+)$/,
                        detect : function() {
                            return regExpTestUpTo(10, this.lineRegExp);
                        },
                        extract : function() {
                            for(let i = 0; i < lines.length; ++i) {
                                let line = lines[i];
                                const hdr = line.match(this.lineRegExp);
                                if(!hdr) {
                                    continue;
                                }
                                const long = [];
                                for(let j = i + 1; j < lines.length; ++j) {
                                    line = lines[j];
                                    if(!line.startsWith(' ')) {
                                        break;
                                    }
                                    long.push(line.trim());
                                    ++i;
                                }
                                const desc      = long.join('\r\n') || hdr[3] || '';
                                const fileName  = hdr[1];
                                const timestamp = moment(hdr[2], 'MM/DD/YY');

                                filesBbs.entries.set(fileName, { timestamp, desc } );
                            }
                        }
                    },

                    {
                        //
                        //  Examples:
                        //  - Night Owl CD #7, 1992
                        //
                        lineRegExp  : /^([^\s]{1,12})\s{2,14}\[0\]\s\s([^\r\n]+)$/,
                        detect : function() {
                            return regExpTestUpTo(10, this.lineRegExp);
                        },
                        extract : function() {
                            for(let i = 0; i < lines.length; ++i) {
                                let line = lines[i];
                                const hdr = line.match(this.lineRegExp);
                                if(!hdr) {
                                    continue;
                                }
                                const long = [ hdr[2].trim() ];
                                for(let j = i + 1; j < lines.length; ++j) {
                                    line = lines[j];
                                    if(!line.startsWith('                               | ')) {
                                        break;
                                    }
                                    long.push(line.substr(33));
                                    ++i;
                                }
                                const desc      = long.join('\r\n');
                                const fileName  = hdr[1];

                                filesBbs.entries.set(fileName, { desc } );
                            }
                        }
                    },

                    {
                        //
                        //  Examples:
                        //  - Aminet Amiga CDROM, March 1994.  Walnut Creek CDROM.
                        //  - CP/M CDROM, Sep. 1994.  Walnut Creek CDROM.
                        //  - ...and many others.
                        //
                        //  Basically: <8.3 filename> <description>
                        //
                        //  May contain headers, but we'll just skip 'em.
                        //
                        lineRegExp : /^([^ ]{1,12})\s{1,11}([^\r\n]+)$/,
                        detect : function() {
                            return regExpTestUpTo(10, this.lineRegExp);
                        },
                        extract : function() {
                            lines.forEach(line => {
                                const hdr = line.match(this.lineRegExp);
                                if(!hdr) {
                                    return; //  forEach
                                }

                                const fileName  = hdr[1].trim();
                                const desc      = hdr[2].trim();

                                if(desc) {
                                    filesBbs.entries.set(fileName, { desc } );
                                }
                            });
                        }
                    },

                    {
                        //
                        //  Examples:
                        //  - AMINET CD's & similar
                        //
                        lineRegExp : /^(.{1,22}) ([0-9]+)K ([^\r\n]+)$/,
                        detect : function() {
                            return regExpTestUpTo(10, this.lineRegExp);
                        },
                        extract : function() {
                            lines.forEach(line => {
                                const hdr = line.match(this.tester);
                                if(!hdr) {
                                    return; //  forEach
                                }

                                const fileName  = hdr[1].trim();
                                let size        = parseInt(hdr[2]);
                                const desc      = hdr[3].trim();

                                if(!isNaN(size)) {
                                    size *= 1024;   //  K->bytes.
                                }

                                if(desc) {  //  omit empty entries
                                    filesBbs.entries.set(fileName, { size, desc } );
                                }
                            });
                        }
                    },
                ];

                const decoder = decoders.find(d => d.detect());
                return decoder;
            };

            const decoder = detectDecoder();
            if(!decoder) {
                return cb(Errors.Invalid('Invalid or unrecognized FILES.BBS format'));
            }

            decoder.extract(decoder);

            return cb(
                filesBbs.entries.size > 0 ? null : Errors.Invalid('Invalid or unrecognized FILES.BBS format'),
                filesBbs
            );
        });
    }


};
